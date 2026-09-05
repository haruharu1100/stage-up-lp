/**
 * 公開中のガチャの「写真だけ」を差し替える。
 *
 * ═══════════════════════════════════════════════════════
 * ★このファイルが触ってよいのは、写真の場所だけ
 * ═══════════════════════════════════════════════════════
 *
 *   触ってよい     gachas.cover_image_id
 *                  gacha_stock.image_id
 *
 *   絶対に触らない 当たりの本数（total）
 *                  出た本数（drawn）
 *                  押さえている本数（reserved）
 *                  残り口数（left_count）
 *                  値段・還元率・検証の結果
 *                  ガチャの構成（GachaSpec）
 *
 *   ★なぜ、そこまで厳しく分けるのか。
 *
 *     写真の差し替えは、店員さんが毎日やる軽い作業です。
 *     「見た目を直すだけ」のつもりで押します。
 *     その軽い操作から、当たりの本数へ手が届いてはいけません。
 *     1本ずれれば、それはもうお客様のお金の話になります。
 *
 *   ★写真を GachaSpec の中に入れないこと。
 *
 *     構成が変わったと見なされ、公開済みのガチャが
 *     「検証しなおし」になります。
 *     写真を1枚替えただけで売り場が止まります。
 *     だから写真は、構成とは別の場所に置いてあります。
 *
 * ═══════════════════════════════════════════════════════
 * ★すでに当たった方の履歴は、絶対に書き換わらないこと
 * ═══════════════════════════════════════════════════════
 *
 *   当選した瞬間の写真は prizes.image_id に写し取ってあります（018）。
 *   ここで在庫表の写真を差し替えても、
 *   「あの人が当てたときに何が表示されていたか」は変わりません。
 *
 *   ★古い写真を消すのは purgeUnusedImageTx に任せること。
 *     あの関数は prizes からも参照を数えているので、
 *     過去の当選記録が指している写真は消しません。
 *     ここで自分で DELETE を書くと、その守りを飛び越えます。
 *
 *   ★写ってはいけないものが写っていた場合（値札・伝票・人の顔・住所）は
 *     差し替えでは足りません。purgeImageHardTx を使う別の操作です。
 *     ここには置きません。間違って押されると履歴が消えるからです。
 */

import { can, type Role } from "@/lib/permissions";
import { appendAuditTx } from "./audit";
import { db, withWriteTx } from "./db";
import { id as newId } from "./ids";
import { imageBelongsToTx, purgeUnusedImageTx } from "./images";

export type GachaImagesCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "NO_REASON"
  | "BAD_IMAGE"
  | "BAD_SLOT"
  | "NO_CHANGE";

export class GachaImagesError extends Error {
  constructor(
    readonly code: GachaImagesCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "GachaImagesError";
  }
}

/** 理由として短すぎる文字数。ガチャ管理と同じ基準にそろえる */
export const MIN_REASON = 4;

/** 表紙をあらわす合図。賞の記号と混ざらないよう、記号側では使えない文字にする */
export const COVER_SLOT = "COVER";

type Actor = { adminId: string; name: string; role: Role };

/* ══════════════════════════════════════════════
   いま何が付いているかを見る
   ══════════════════════════════════════════════ */

export type ImageSlot = {
  /** "COVER" か、賞の記号（"S" "A" など） */
  slot: string;
  /** 画面に出す名前 */
  label: string;
  /** いま付いている写真。無ければ null */
  imageId: string | null;
  /**
   * すでに出た本数。
   * ★0本でないなら、差し替えても過去の当選記録は変わらない、と
   *   画面で必ず伝えること。黙って替えると
   *   「勝手に景品を替えられた」と受け取られます。
   */
  drawn: number;
  total: number;
};

export type GachaImagesView = {
  gachaId: string;
  title: string;
  status: string;
  slots: ImageSlot[];
  history: ImageHistoryRow[];
};

export type ImageHistoryRow = {
  id: string;
  slot: string;
  kind: string;
  oldImageId: string | null;
  newImageId: string | null;
  reason: string | null;
  at: string;
  byName: string | null;
};

export async function getGachaImages(
  tenantId: string,
  gachaId: string,
): Promise<GachaImagesView> {
  /* ★会社の壁。tenant_id を条件から外さないこと。
       外すと、入口を直接たたくだけで他社のガチャの写真が見えます。 */
  const g = await db().execute({
    sql: `SELECT id, title, status, cover_image_id
            FROM gachas WHERE tenant_id = ? AND id = ?`,
    args: [tenantId, gachaId],
  });
  if (g.rows.length === 0) {
    throw new GachaImagesError("NOT_FOUND", "そのガチャは見つかりませんでした。");
  }
  const row = g.rows[0] as Record<string, unknown>;

  const st = await db().execute({
    sql: `SELECT grade, name, image_id, total, drawn
            FROM gacha_stock WHERE tenant_id = ? AND gacha_id = ?
           ORDER BY value DESC, grade ASC`,
    args: [tenantId, gachaId],
  });

  const slots: ImageSlot[] = [
    {
      slot: COVER_SLOT,
      label: "表紙（一覧に出る写真）",
      imageId: row.cover_image_id === null || row.cover_image_id === undefined
        ? null
        : String(row.cover_image_id),
      drawn: 0,
      total: 0,
    },
    ...st.rows.map((r) => {
      const x = r as Record<string, unknown>;
      const grade = String(x.grade ?? "");
      return {
        slot: grade,
        label: String(x.name ?? "") || `${grade}賞`,
        imageId: x.image_id === null || x.image_id === undefined ? null : String(x.image_id),
        drawn: Number(x.drawn ?? 0),
        total: Number(x.total ?? 0),
      };
    }),
  ];

  const h = await db().execute({
    sql: `SELECT id, slot, kind, old_image_id, new_image_id, reason,
                 replaced_at, replaced_name
            FROM image_replacements
           WHERE tenant_id = ? AND gacha_id = ?
           ORDER BY replaced_at DESC LIMIT 50`,
    args: [tenantId, gachaId],
  });

  return {
    gachaId: String(row.id ?? ""),
    title: String(row.title ?? ""),
    status: String(row.status ?? ""),
    slots,
    history: h.rows.map((r) => {
      const x = r as Record<string, unknown>;
      const nul = (v: unknown) => (v === null || v === undefined ? null : String(v));
      return {
        id: String(x.id ?? ""),
        slot: String(x.slot ?? ""),
        kind: String(x.kind ?? "REPLACE"),
        oldImageId: nul(x.old_image_id),
        newImageId: nul(x.new_image_id),
        reason: nul(x.reason),
        at: String(x.replaced_at ?? ""),
        byName: nul(x.replaced_name),
      };
    }),
  };
}

/* ══════════════════════════════════════════════
   差し替える
   ══════════════════════════════════════════════ */

export type ReplaceInput = {
  tenantId: string;
  gachaId: string;
  /**
   * 差し替える中身。
   *   キー   "COVER" か賞の記号
   *   値     新しい写真のID。null は「写真を外す」
   * ★書かれていない場所は、いっさい触りません。
   *   「送られてこなかった＝消してよい」と読まないこと。
   *   画面の不具合で1つ抜けただけで、全部の写真が消えます。
   */
  slots: Record<string, string | null>;
  reason: string;
  by: Actor;
  requestId?: string;
};

export type ReplaceResult = {
  changed: { slot: string; from: string | null; to: string | null }[];
  at: string;
};

export async function replaceGachaImages(input: ReplaceInput): Promise<ReplaceResult> {
  /* ★見るだけの人に差し替えさせないこと。
       写真は、お客様がお金を払う判断の材料そのものです。 */
  if (!can(input.by.role, "gacha.edit")) {
    throw new GachaImagesError(
      "FORBIDDEN",
      "写真を差し替える権限がありません。ガチャを作る・直す権限が要ります。",
    );
  }

  const reason = String(input.reason ?? "").trim();
  if (reason.length < MIN_REASON) {
    throw new GachaImagesError(
      "NO_REASON",
      `差し替える理由を${MIN_REASON}文字以上で書いてください。あとで「なぜ替えたのか」を確かめられるようにするためです。`,
    );
  }

  const at = new Date().toISOString();

  return withWriteTx(async (tx) => {
    const g = await tx.execute({
      sql: `SELECT id, title, status, cover_image_id
              FROM gachas WHERE tenant_id = ? AND id = ?`,
      args: [input.tenantId, input.gachaId],
    });
    if (g.rows.length === 0) {
      throw new GachaImagesError("NOT_FOUND", "そのガチャは見つかりませんでした。");
    }
    const gr = g.rows[0] as Record<string, unknown>;
    const title = String(gr.title ?? "");
    /* ★status は見るだけ。ここで公開を止めたり再開したりしないこと。
         写真の差し替えは、公開中でもそのまま通します。
         止めてから替える運用にすると、売り場が毎回落ちます。 */

    const st = await tx.execute({
      sql: `SELECT grade, image_id FROM gacha_stock
             WHERE tenant_id = ? AND gacha_id = ?`,
      args: [input.tenantId, input.gachaId],
    });
    const stockNow = new Map<string, string | null>();
    for (const r of st.rows) {
      const x = r as Record<string, unknown>;
      stockNow.set(
        String(x.grade ?? ""),
        x.image_id === null || x.image_id === undefined ? null : String(x.image_id),
      );
    }

    const coverNow =
      gr.cover_image_id === null || gr.cover_image_id === undefined
        ? null
        : String(gr.cover_image_id);

    const changed: { slot: string; from: string | null; to: string | null }[] = [];
    /* 外された写真。あとでどこからも使われていなければ片付けます */
    const orphans = new Set<string>();

    for (const [rawSlot, rawTo] of Object.entries(input.slots ?? {})) {
      const slot = String(rawSlot ?? "").trim();
      if (!slot) continue;

      const isCover = slot === COVER_SLOT;
      if (!isCover && !stockNow.has(slot)) {
        throw new GachaImagesError(
          "BAD_SLOT",
          `「${slot}」という賞は、このガチャにありません。`,
        );
      }

      const to = rawTo === null || rawTo === undefined ? null : String(rawTo).trim() || null;

      /* ★他社の写真IDを弾くこと。
           ここを飛ばすと、IDを1つ書き換えるだけで
           他社の未公開の写真を自分の売り場に出せます。 */
      if (to && !(await imageBelongsToTx(tx, input.tenantId, to))) {
        throw new GachaImagesError(
          "BAD_IMAGE",
          "選ばれた写真が見つかりませんでした。もう一度アップロードしてください。",
        );
      }

      const from = isCover ? coverNow : (stockNow.get(slot) ?? null);
      if (from === to) continue;

      if (isCover) {
        await tx.execute({
          sql: `UPDATE gachas SET cover_image_id = ? WHERE tenant_id = ? AND id = ?`,
          args: [to, input.tenantId, input.gachaId],
        });
      } else {
        /* ★UPDATE するのは image_id の1列だけ。
             ここに total や drawn を足さないこと。
             写真の操作から当たりの本数へ手が届いた時点で、
             このファイルの意味がなくなります。 */
        await tx.execute({
          sql: `UPDATE gacha_stock SET image_id = ?
                 WHERE tenant_id = ? AND gacha_id = ? AND grade = ?`,
          args: [to, input.tenantId, input.gachaId, slot],
        });
      }

      await tx.execute({
        sql: `INSERT INTO image_replacements
                (id, tenant_id, gacha_id, slot, old_image_id, new_image_id,
                 kind, reason, replaced_at, replaced_by, replaced_name)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        args: [
          newId("imgrep"),
          input.tenantId,
          input.gachaId,
          slot,
          from,
          to,
          to === null ? "REMOVE" : "REPLACE",
          reason,
          at,
          input.by.adminId,
          input.by.name,
        ],
      });

      if (from) orphans.add(from);
      changed.push({ slot, from, to });
    }

    if (changed.length === 0) {
      throw new GachaImagesError(
        "NO_CHANGE",
        "変わったところがありません。写真を選んでから保存してください。",
      );
    }

    await appendAuditTx(tx, {
      tenantId: input.tenantId,
      at,
      actorKind: "ADMIN",
      actorId: input.by.adminId,
      actorName: input.by.name,
      actorRole: input.by.role,
      action: "IMAGE_REPLACE",
      target: `gacha:${input.gachaId}`,
      summary: `${title} の写真を ${changed.length} か所差し替え（${changed
        .map((c) => (c.slot === COVER_SLOT ? "表紙" : `${c.slot}賞`))
        .join("・")}）：${reason}`,
      data: {
        gachaId: input.gachaId,
        status: String(gr.status ?? ""),
        reason,
        changed,
        /* ★「当選済みの記録は変えていない」を記録にも残すこと。
             あとで問い合わせが来たときに、
             履歴だけで説明できるようにするためです。 */
        wonPrizesUntouched: true,
      },
      requestId: input.requestId,
    });

    /* ★片付けは最後。しかも purgeUnusedImageTx 経由で。
         あの関数が gachas / gacha_stock / prizes の3つを数えます。
         過去の当選記録が指している写真は、ここでは消えません。 */
    for (const old of Array.from(orphans)) {
      await purgeUnusedImageTx(tx, input.tenantId, old);
    }

    return { changed, at };
  });
}
