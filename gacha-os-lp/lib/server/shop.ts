/**
 * お客様が見る「売り場」の中身を、DBから読む。
 *
 * ═══════════════════════════════════════════════════════
 * ★2026-09-05 まで、この売り場がありませんでした
 * ═══════════════════════════════════════════════════════
 *
 *   引く仕組み（lib/server/draw.ts）も、
 *   引く入口（/api/console/draw）も、ずっと完成していました。
 *   当たった商品が届くところまで、通しで動いていました。
 *
 *   足りなかったのは、その入口を叩く画面です。
 *   お客様はログインできて、ポイントも当選品も見られるのに、
 *   ガチャを引く場所だけが、どこにもありませんでした。
 *
 *   ★「裏側が完成している」と「売れる」は、別のことです。
 *     お客様が触れる場所が無い機能は、無いのと同じです。
 *
 * ═══════════════════════════════════════════════════════
 * ★運営の数字を、ここから返さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   gachas には revenue（売上）や paid_value（払い出した額）が
 *   入っています。管理画面はこれを使いますが、
 *   お客様の画面へは1つも渡しません。
 *
 *   渡すと、通信の中身を見るだけで
 *   その店の粗利が分かります。競合にも分かります。
 *   「画面に出していないから大丈夫」は通りません。
 *   出していなくても、送っていれば読まれます。
 *
 * ═══════════════════════════════════════════════════════
 * ★還元率を、お客様の画面へ数字で出さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   設計上の還元率は「箱をぜんぶ引き切ったとき」の数字です。
 *   1回引く方にとっての取り分ではありません。
 *   これを大きく出すと、有利誤認（景品表示法）になり得ます。
 *
 *   代わりに、賞ごとの「残り本数 / 全体の本数」をそのまま出します。
 *   これは事実そのもので、読んだ方が自分で判断できます。
 */

import { db } from "./db";
import { getCategoriesForGachas } from "./gachaCategories";
import { getGradeLabels, gradeLabelOf } from "./gradeLabels";

type Row = Record<string, unknown>;

const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => String(v ?? "");
const strOrNull = (v: unknown) => (v == null ? null : String(v));

/** 売り場に並ぶ1本 */
export type ShopItem = {
  id: string;
  title: string;
  /** 1回の料金（pt） */
  price: number;
  /** 全体の口数 */
  total: number;
  /** 残りの口数 */
  left: number;
  publishedAt: string | null;
  /**
   * いちばん高い賞。表紙に出します。
   *
   * ★残っていない賞を「目玉」として出さないこと。
   *   売り切れた賞を表紙に出し続けるのは、有利誤認です。
   */
  top: { grade: string; gradeLabel: string; name: string; value: number } | null;
  /** いちばん上の等級の残り本数（0 なら出しません） */
  sLeft: number;

  /**
   * 表紙の写真のID。お店がまだ入れていなければ null。
   *
   * ═══════════════════════════════════════════════════════
   * ★null のときに、それらしい絵を描かないこと
   * ═══════════════════════════════════════════════════════
   *
   *   2026-09-05 まで、ここは題名の文字から絵を描いていました。
   *   題名に「カード」とあればカードの形、「時計」とあれば時計の形。
   *   権利の心配がなく、運用も要らない、よくできた仕組みでした。
   *
   *   ですが、お客様がお金を払って引くのは実物です。
   *   実物と違う絵を並べて売るのは、優良誤認になりかねません。
   *
   *   だから、写真が無いときは「画像未登録」と、そう書きます。
   *   空欄は、それらしい嘘よりずっと安全です。
   */
  coverImageId: string | null;

  /**
   * この1本が入っている棚（カテゴリ）のID。
   *
   * ═══════════════════════════════════════════════════════
   * ★棚の名前を、こちらのコードに書かないこと
   * ═══════════════════════════════════════════════════════
   *
   *   「ポケモン／ワンピース／スニーカー」を書いた瞬間、
   *   時計を売るお店が来たときに、こちらへ連絡が来ます。
   *   そのたびに直して出し直すのなら、それは商品ではなく受託です。
   *
   *   棚は必ずDB（gacha_categories）にあります。
   *   ここが返すのはIDだけで、名前は categories の側にあります。
   *
   * ★棚に入っていないガチャがあってよいこと。
   *   「必ずどれかに入れる」にすると、棚を作っていないお店は
   *   1本も並べられなくなります。空配列でそのまま並びます。
   */
  categoryIds: string[];
};

/** 売り場の絞り込みに出す棚。★名前はDBの値をそのまま使います */
export type ShopCategory = { id: string; name: string; count: number };

/** 1本ぶんの詳しい中身 */
export type ShopDetail = ShopItem & {
  prizes: {
    /**
     * 中の記号（S / A / B / C / D）。
     * ★これは仕様であって、お客様に見せる文字ではありません。
     *   見せるのは、必ず下の gradeLabel を使ってください。
     */
    grade: string;
    /**
     * お店が決めた、その等級の呼び名（特賞 / 1等 / PSA10賞 など）。
     * 決めていなければ「S賞」のような既定の呼び名が入ります。
     * ★空文字は入りません。呼ぶ側で「無かったら」を書かなくて済みます。
     */
    gradeLabel: string;
    name: string;
    value: number;
    total: number;
    left: number;
    /** この賞の写真。無ければ null（描かずに「画像未登録」と出す） */
    imageId: string | null;
  }[];
};

/**
 * 賞の一覧から「表紙に出す賞」と「S賞の残り」を決める。
 *
 * ★残り0本の賞は、目玉から外すこと。
 */
function medama(prizes: ShopDetail["prizes"]): {
  top: ShopItem["top"];
  sLeft: number;
} {
  const nokori = prizes.filter((p) => p.left > 0);
  const top =
    nokori.length === 0
      ? null
      : nokori.reduce((a, b) => (b.value > a.value ? b : a));
  const s = prizes.find((p) => p.grade === "S");
  return {
    top: top
      ? {
          grade: top.grade,
          gradeLabel: top.gradeLabel,
          name: top.name,
          value: top.value,
        }
      : null,
    sLeft: s ? s.left : 0,
  };
}

/**
 * 販売中のガチャを並べる。
 *
 * ★status を外から受け取らないこと。
 *   「どの状態のものを見せるか」を問い合わせで決められる作りにすると、
 *   DRAFT（下書き）や PAUSED（停止中）のガチャを
 *   URLを1文字変えるだけでお客様に見せられます。
 *   下書きは、まだ世に出していない商品です。
 */
export async function listShopGachas(tenantId: string): Promise<ShopItem[]> {
  const g = await db().execute({
    sql: `SELECT id, title, price, total, left_count, published_at, cover_image_id
            FROM gachas
           WHERE tenant_id = ? AND status = 'PUBLISHED'
           ORDER BY published_at DESC, id DESC`,
    args: [tenantId],
  });

  const rows = g.rows as Row[];
  if (rows.length === 0) return [];

  /* 賞は1回でまとめて読む。
     ★1本ずつ読みに行かないこと。20本並べば20往復になります。 */
  const ids = rows.map((r) => str(r.id));
  const anaume = ids.map(() => "?").join(",");
  const s = await db().execute({
    sql: `SELECT gacha_id, grade, name, value, total, drawn, image_id
            FROM gacha_stock
           WHERE tenant_id = ? AND gacha_id IN (${anaume})
           ORDER BY grade ASC`,
    args: [tenantId, ...ids],
  });

  /* ★呼び名は、この1回だけ読むこと。
       賞の行ごとに読みに行くと、20本×5等級で100往復になります。 */
  const yobina = await getGradeLabels(tenantId);

  const betsu = new Map<string, ShopDetail["prizes"]>();
  for (const x of s.rows as Row[]) {
    const key = str(x.gacha_id);
    const list = betsu.get(key) ?? [];
    list.push({
      grade: str(x.grade),
      gradeLabel: gradeLabelOf(yobina, str(x.grade)),
      name: str(x.name),
      value: num(x.value),
      total: num(x.total),
      left: num(x.total) - num(x.drawn),
      imageId: strOrNull(x.image_id),
    });
    betsu.set(key, list);
  }

  /* 棚も1回でまとめて読む。★1本ずつ読みに行かないこと */
  const tana = await getCategoriesForGachas(tenantId, ids);

  return rows.map((r) => {
    const id = str(r.id);
    const { top, sLeft } = medama(betsu.get(id) ?? []);
    return {
      id,
      title: str(r.title),
      price: num(r.price),
      total: num(r.total),
      left: num(r.left_count),
      publishedAt: strOrNull(r.published_at),
      top,
      sLeft,
      coverImageId: strOrNull(r.cover_image_id),
      categoryIds: tana.get(id) ?? [],
    };
  });
}

/**
 * 売り場の絞り込みに出す棚。
 *
 * ═══════════════════════════════════════════════════════
 * ★中身が1本も無い棚を、お客様に出さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   お店は先に棚だけ作ります（「スニーカー」「時計」…）。
 *   その棚をそのまま並べると、押した先が毎回「0件」になります。
 *   お客様には、品切ればかりの店に見えます。
 *
 *   ですので、公開中のガチャが1本以上入っている棚だけを返します。
 *   ★数えるのは PUBLISHED だけ。下書きや停止中を数に入れると、
 *     「3本」と書いてある棚を開いて1本しか無い、が起きます。
 */
export async function listShopCategories(
  tenantId: string,
): Promise<ShopCategory[]> {
  const res = await db().execute({
    sql: `SELECT c.id, c.name, COUNT(g.id) AS n
            FROM gacha_categories c
            JOIN gacha_category_links l
              ON l.tenant_id = c.tenant_id AND l.category_id = c.id
            JOIN gachas g
              ON g.tenant_id = c.tenant_id AND g.id = l.gacha_id
             AND g.status = 'PUBLISHED'
           WHERE c.tenant_id = ?
           GROUP BY c.id, c.name, c.sort_order, c.created_at
           HAVING COUNT(g.id) > 0
           ORDER BY c.sort_order ASC, c.created_at ASC`,
    args: [tenantId],
  });

  return (res.rows as Row[]).map((r) => ({
    id: str(r.id),
    name: str(r.name),
    count: num(r.n),
  }));
}

/**
 * 1本ぶんの詳しい中身。
 *
 * ★見つからないときに「他社のガチャです」と答えないこと。
 *   有る／無いを答えるだけで、他社が何を出しているかが探れます。
 *   だから null を返し、呼ぶ側は「見つかりません」で揃えます。
 *
 * ★公開していないものは、ここでも返さないこと。
 *   一覧で隠しても、詳細で見えるなら隠したことになりません。
 */
export async function shopGachaDetail(
  tenantId: string,
  gachaId: string,
): Promise<ShopDetail | null> {
  const g = await db().execute({
    sql: `SELECT id, title, price, total, left_count, published_at, cover_image_id
            FROM gachas
           WHERE tenant_id = ? AND id = ? AND status = 'PUBLISHED'`,
    args: [tenantId, gachaId],
  });
  const row = g.rows[0] as Row | undefined;
  if (!row) return null;

  const s = await db().execute({
    sql: `SELECT grade, name, value, total, drawn, image_id
            FROM gacha_stock
           WHERE tenant_id = ? AND gacha_id = ?
           ORDER BY grade ASC`,
    args: [tenantId, gachaId],
  });

  const yobina = await getGradeLabels(tenantId);
  const prizes = (s.rows as Row[]).map((x) => ({
    grade: str(x.grade),
    gradeLabel: gradeLabelOf(yobina, str(x.grade)),
    name: str(x.name),
    value: num(x.value),
    total: num(x.total),
    left: num(x.total) - num(x.drawn),
    imageId: strOrNull(x.image_id),
  }));

  const { top, sLeft } = medama(prizes);
  const tana = await getCategoriesForGachas(tenantId, [gachaId]);

  return {
    id: str(row.id),
    title: str(row.title),
    price: num(row.price),
    total: num(row.total),
    left: num(row.left_count),
    publishedAt: strOrNull(row.published_at),
    top,
    sLeft,
    coverImageId: strOrNull(row.cover_image_id),
    categoryIds: tana.get(gachaId) ?? [],
    prizes,
  };
}
