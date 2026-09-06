/**
 * ガチャの棚（カテゴリ）。名前を決めるのは、こちらではなくお店です。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、コードにカテゴリ名を書かないのか
 * ═══════════════════════════════════════════════════════
 *
 *   「ポケモン／ワンピース／スニーカー／ブランド／その他」を
 *   コードの配列で持てば、今日は動きます。
 *
 *   動かなくなるのは、6つ目が要る日です。
 *   その日、お店は自分では何もできず、こちらに連絡してきます。
 *   こちらが直して、確かめて、公開し直します。
 *
 *   ★それが1社なら「対応」ですが、10社になると「本業」になります。
 *     そうなった時点で、これは商品ではなく受託です。
 *
 *   ですので、棚は表で持ちます。名前はお店が決めます。
 *   こちらは、何を売るお店なのかを知らなくてよい形にします。
 *
 * ═══════════════════════════════════════════════════════
 * ★1ガチャに複数の棚を許した理由（あとから戻せないから）
 * ═══════════════════════════════════════════════════════
 *
 *   「1ガチャ＝1カテゴリ」のほうが、画面も実装も簡単です。
 *   ですが、それは ★狭いほうへ倒す決定です。
 *
 *   「ポケモン」かつ「高額」に置きたくなった日に、
 *   1対1で作っていると、表の作り直しになります。
 *   すでに本番で動いているデータを移し替える話になります。
 *
 *   逆に、複数を持てる形で作っておけば、
 *   お店が1つしか付けなければ、それは1カテゴリの運用そのものです。
 *
 *   ★つまり「複数可」は「1つだけ」を含んでいます。
 *     含んでいるほうを選びます。
 *     画面の側は、当面「1つ選ぶ」で作っても構いません。
 *
 * ═══════════════════════════════════════════════════════
 * ★棚を消したときに、ガチャを消さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   棚を消すと、そこに入っていたガチャは「棚なし」になります。
 *   ★ガチャそのものは、絶対に消しません。
 *     売っている最中の商品が、棚の整理で消えてはいけません。
 *
 *   棚なしのガチャは、一覧には出ます（「すべて」で見えます）。
 *   絞り込みからだけ、いなくなります。
 */

import { withWriteTx, db } from "./db";
import { appendAuditTx } from "./audit";
import { id } from "./ids";
import type { Actor } from "./orders";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (v == null ? "" : String(v));

export class CategoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CategoryError";
    this.code = code;
  }
}

const NAME_MAX = 30;
/** ★上限を置く理由：絞り込みの並びが、画面に収まらなくなるからです */
export const CATEGORY_MAX_COUNT = 30;
/** 1つのガチャに付けられる棚の数 */
export const PER_GACHA_MAX = 5;

export type Category = {
  id: string;
  name: string;
  order: number;
  /** その棚に入っているガチャの数（公開・非公開をあわせた数） */
  gachaCount: number;
};

function checkName(raw: unknown): string {
  const v = str(raw).trim();
  if (v === "") {
    throw new CategoryError("NAME_REQUIRED", "カテゴリ名を入力してください。");
  }
  if (v.length > NAME_MAX) {
    throw new CategoryError(
      "NAME_TOO_LONG",
      `カテゴリ名は ${NAME_MAX} 文字までです。`,
    );
  }
  return v;
}

/** 棚の一覧。中に何本入っているかも一緒に返します */
export async function listCategories(tenantId: string): Promise<Category[]> {
  const res = await db().execute({
    sql: `SELECT c.id, c.name, c.sort_order,
                 (SELECT COUNT(*) FROM gacha_category_links l
                   WHERE l.tenant_id = c.tenant_id AND l.category_id = c.id) AS n
            FROM gacha_categories c
           WHERE c.tenant_id = ?
           ORDER BY c.sort_order ASC, c.created_at ASC`,
    args: [tenantId],
  });
  return (res.rows as unknown as Row[]).map((r) => ({
    id: str(r.id),
    name: str(r.name),
    order: Number(r.sort_order ?? 0),
    gachaCount: Number(r.n ?? 0),
  }));
}

export async function createCategory(args: {
  tenantId: string;
  name: unknown;
  actor: Actor;
  requestId: string;
  now?: string;
}): Promise<Category> {
  const at = args.now ?? new Date().toISOString();
  const name = checkName(args.name);

  return withWriteTx(async (tx) => {
    const cnt = await tx.execute({
      sql: `SELECT COUNT(*) AS n, MAX(sort_order) AS mx
              FROM gacha_categories WHERE tenant_id = ?`,
      args: [args.tenantId],
    });
    const row = cnt.rows[0] as Row;
    const n = Number(row?.n ?? 0);
    if (n >= CATEGORY_MAX_COUNT) {
      throw new CategoryError(
        "TOO_MANY",
        `カテゴリは ${CATEGORY_MAX_COUNT} 個までです。使っていないものを削除してください。`,
      );
    }

    const dup = await tx.execute({
      sql: `SELECT id FROM gacha_categories WHERE tenant_id = ? AND name = ?`,
      args: [args.tenantId, name],
    });
    if (dup.rows.length > 0) {
      throw new CategoryError(
        "DUPLICATE",
        `「${name}」は、すでにあります。同じ名前のカテゴリは作れません。`,
      );
    }

    const cid = id("cat");
    const order = Number(row?.mx ?? -1) + 1;

    await tx.execute({
      sql: `INSERT INTO gacha_categories
              (id, tenant_id, name, sort_order, created_at)
            VALUES (?,?,?,?,?)`,
      args: [cid, args.tenantId, name, order, at],
    });

    await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: args.actor.kind,
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      action: "GACHA_CATEGORY_CREATE",
      target: `category:${cid}`,
      summary: `カテゴリ「${name}」を追加しました`,
      after: name,
      reason: "お店の設定変更",
      requestId: args.requestId,
      data: { categoryId: cid, name, order },
    });

    return { id: cid, name, order, gachaCount: 0 };
  });
}

export async function renameCategory(args: {
  tenantId: string;
  categoryId: string;
  name: unknown;
  actor: Actor;
  requestId: string;
  now?: string;
}): Promise<Category> {
  const at = args.now ?? new Date().toISOString();
  const name = checkName(args.name);

  return withWriteTx(async (tx) => {
    const cur = await tx.execute({
      sql: `SELECT id, name, sort_order FROM gacha_categories
             WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.categoryId],
    });
    const row = cur.rows[0] as Row | undefined;
    if (!row) {
      throw new CategoryError("NOT_FOUND", "そのカテゴリは見つかりませんでした。");
    }
    const mae = str(row.name);
    if (mae === name) {
      return {
        id: args.categoryId,
        name,
        order: Number(row.sort_order ?? 0),
        gachaCount: 0,
      };
    }

    const dup = await tx.execute({
      sql: `SELECT id FROM gacha_categories
             WHERE tenant_id = ? AND name = ? AND id <> ?`,
      args: [args.tenantId, name, args.categoryId],
    });
    if (dup.rows.length > 0) {
      throw new CategoryError(
        "DUPLICATE",
        `「${name}」は、すでにあります。同じ名前のカテゴリは作れません。`,
      );
    }

    await tx.execute({
      sql: `UPDATE gacha_categories SET name = ?
             WHERE tenant_id = ? AND id = ?`,
      args: [name, args.tenantId, args.categoryId],
    });

    await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: args.actor.kind,
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      action: "GACHA_CATEGORY_RENAME",
      target: `category:${args.categoryId}`,
      summary: `カテゴリの名前を「${mae}」から「${name}」に変えました`,
      before: mae,
      after: name,
      reason: "お店の設定変更",
      requestId: args.requestId,
      data: { categoryId: args.categoryId, nameBefore: mae, nameAfter: name },
    });

    return {
      id: args.categoryId,
      name,
      order: Number(row.sort_order ?? 0),
      gachaCount: 0,
    };
  });
}

/**
 * 棚を消す。
 *
 * ★中に入っていたガチャは、絶対に消しません。「棚なし」になるだけです。
 *   何本が棚なしになったのかを、記録に残します。
 *   「昨日まで一覧の絞り込みに出ていたのに」の答えが、そこにあります。
 */
export async function deleteCategory(args: {
  tenantId: string;
  categoryId: string;
  actor: Actor;
  requestId: string;
  now?: string;
}): Promise<{ removedLinks: number }> {
  const at = args.now ?? new Date().toISOString();

  return withWriteTx(async (tx) => {
    const cur = await tx.execute({
      sql: `SELECT name FROM gacha_categories WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.categoryId],
    });
    const row = cur.rows[0] as Row | undefined;
    if (!row) {
      throw new CategoryError("NOT_FOUND", "そのカテゴリは見つかりませんでした。");
    }
    const name = str(row.name);

    const cnt = await tx.execute({
      sql: `SELECT COUNT(*) AS n FROM gacha_category_links
             WHERE tenant_id = ? AND category_id = ?`,
      args: [args.tenantId, args.categoryId],
    });
    const n = Number((cnt.rows[0] as Row)?.n ?? 0);

    await tx.execute({
      sql: `DELETE FROM gacha_category_links
             WHERE tenant_id = ? AND category_id = ?`,
      args: [args.tenantId, args.categoryId],
    });
    await tx.execute({
      sql: `DELETE FROM gacha_categories WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.categoryId],
    });

    await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: args.actor.kind,
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      action: "GACHA_CATEGORY_DELETE",
      target: `category:${args.categoryId}`,
      summary:
        `カテゴリ「${name}」を削除しました` +
        (n > 0
          ? `（${n} 本のガチャがカテゴリなしになりました。ガチャ自体は消えていません）`
          : "（中にガチャはありませんでした）"),
      before: name,
      after: "削除",
      reason: "お店の設定変更",
      requestId: args.requestId,
      data: { categoryId: args.categoryId, name, unlinkedGachas: n },
    });

    return { removedLinks: n };
  });
}

/** そのガチャが、いまどの棚に入っているか */
export async function getGachaCategories(
  tenantId: string,
  gachaId: string,
): Promise<string[]> {
  const res = await db().execute({
    sql: `SELECT category_id FROM gacha_category_links
           WHERE tenant_id = ? AND gacha_id = ?`,
    args: [tenantId, gachaId],
  });
  return (res.rows as unknown as Row[]).map((r) => str(r.category_id));
}

/** 一覧画面のために、複数のガチャの棚をまとめて引く */
export async function getCategoriesForGachas(
  tenantId: string,
  gachaIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (gachaIds.length === 0) return out;

  const holes = gachaIds.map(() => "?").join(",");
  const res = await db().execute({
    sql: `SELECT gacha_id, category_id FROM gacha_category_links
           WHERE tenant_id = ? AND gacha_id IN (${holes})`,
    args: [tenantId, ...gachaIds],
  });

  for (const r of res.rows as unknown as Row[]) {
    const g = str(r.gacha_id);
    const list = out.get(g) ?? [];
    list.push(str(r.category_id));
    out.set(g, list);
  }
  return out;
}

/**
 * ガチャの棚を、まとめて付け替える（送られた一覧の通りにします）。
 *
 * ★1件ずつの追加・削除にしなかった理由：
 *   途中で失敗したときに、「片方だけ付いた」状態が残るからです。
 *   まとめて入れ替えれば、失敗したときは全部が元のままになります。
 */
export async function setGachaCategories(args: {
  tenantId: string;
  gachaId: string;
  categoryIds: unknown;
  actor: Actor;
  requestId: string;
  now?: string;
}): Promise<string[]> {
  const at = args.now ?? new Date().toISOString();

  const raw = Array.isArray(args.categoryIds) ? args.categoryIds : [];
  /* 同じものが2回来ても、1つとして扱います */
  const want = Array.from(new Set(raw.map((v) => str(v).trim()).filter(Boolean)));

  if (want.length > PER_GACHA_MAX) {
    throw new CategoryError(
      "TOO_MANY",
      `1つのガチャに付けられるカテゴリは ${PER_GACHA_MAX} 個までです。`,
    );
  }

  return withWriteTx(async (tx) => {
    const g = await tx.execute({
      sql: `SELECT id, title FROM gachas WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.gachaId],
    });
    const grow = g.rows[0] as Row | undefined;
    if (!grow) {
      throw new CategoryError("NO_GACHA", "そのガチャは見つかりませんでした。");
    }

    /* ★よその会社の棚を付けられないこと。
         ここを飛ばすと、IDを打ち替えるだけで
         他社の棚に自分のガチャを置けてしまいます。 */
    const namae = new Map<string, string>();
    if (want.length > 0) {
      const holes = want.map(() => "?").join(",");
      const found = await tx.execute({
        sql: `SELECT id, name FROM gacha_categories
               WHERE tenant_id = ? AND id IN (${holes})`,
        args: [args.tenantId, ...want],
      });
      for (const r of found.rows as unknown as Row[]) {
        namae.set(str(r.id), str(r.name));
      }
      const missing = want.filter((c) => !namae.has(c));
      if (missing.length > 0) {
        throw new CategoryError(
          "NOT_FOUND",
          "指定されたカテゴリの中に、見つからないものがあります。",
        );
      }
    }

    const before = await tx.execute({
      sql: `SELECT l.category_id, c.name
              FROM gacha_category_links l
              LEFT JOIN gacha_categories c
                ON c.id = l.category_id AND c.tenant_id = l.tenant_id
             WHERE l.tenant_id = ? AND l.gacha_id = ?`,
      args: [args.tenantId, args.gachaId],
    });
    const maeIds = (before.rows as unknown as Row[]).map((r) =>
      str(r.category_id),
    );
    const maeNames = (before.rows as unknown as Row[]).map(
      (r) => str(r.name) || "(削除済み)",
    );

    const onaji =
      maeIds.length === want.length &&
      [...maeIds].sort().join(",") === [...want].sort().join(",");

    await tx.execute({
      sql: `DELETE FROM gacha_category_links
             WHERE tenant_id = ? AND gacha_id = ?`,
      args: [args.tenantId, args.gachaId],
    });

    for (const cid of want) {
      await tx.execute({
        sql: `INSERT INTO gacha_category_links
                (tenant_id, gacha_id, category_id, created_at)
              VALUES (?,?,?,?)`,
        args: [args.tenantId, args.gachaId, cid, at],
      });
    }

    /* ★何も変わっていないなら、記録を足さないこと。
         「保存を押した」だけの行が積み上がると、
         本当に変わった行が、その中に埋もれます。 */
    if (!onaji) {
      const atoNames = want.map((c) => namae.get(c) ?? c);
      await appendAuditTx(tx, {
        tenantId: args.tenantId,
        at,
        actorKind: args.actor.kind,
        actorId: args.actor.id,
        actorName: args.actor.name,
        actorRole: args.actor.role,
        action: "GACHA_CATEGORY_ASSIGN",
        target: `gacha:${args.gachaId}`,
        summary: `「${str(grow.title)}」のカテゴリを付け替えました`,
        before: maeNames.length > 0 ? maeNames.join("／") : "カテゴリなし",
        after: atoNames.length > 0 ? atoNames.join("／") : "カテゴリなし",
        reason: "お店の設定変更",
        requestId: args.requestId,
        data: {
          gachaId: args.gachaId,
          before: maeIds,
          after: want,
        },
      });
    }

    return want;
  });
}
