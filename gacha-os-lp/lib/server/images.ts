/**
 * 商品の写真を預かり、確かめ、しまう。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ「絵を描く」のをやめたのか
 * ═══════════════════════════════════════════════════════
 *
 *   これまで、ガチャの絵は題名の文字から機械が描いていました。
 *   題名に「カード」とあればカードの形、「時計」とあれば時計の形。
 *   権利の心配がなく、運用も要らない、よくできた仕組みでした。
 *
 *   ですが、お客様がお金を払って引くのは「実物」です。
 *   実物と違う絵を並べて売るのは、優良誤認になりかねません。
 *   だから、お店が撮った実物の写真だけを出す形に変えます。
 *
 *   ★お店が写真を入れていないときに、それらしい絵を描かないこと。
 *     描いてしまうと、お客様には「これが中身だ」と見えます。
 *     入っていないときは「画像未登録」と、そう書きます。
 *
 * ═══════════════════════════════════════════════════════
 * ★アップロードは、いちばん危ない入口です
 * ═══════════════════════════════════════════════════════
 *
 *   ここは「外から来たファイルを、こちらのサーバーに置く」入口です。
 *   守り方を間違えると、置かれたものがそのまま実行されます。
 *
 *   だから、次の順で確かめます。どれか1つでも欠けたら断ります。
 *
 *     ①大きさ    … 上限を超えていないか（メモリを食い潰されない）
 *     ②拡張子    … .jpg .jpeg .png .webp のどれか
 *     ③申告MIME  … image/jpeg image/png image/webp のどれか
 *     ④中身の頭  … 本当にその形式のバイト列で始まっているか
 *     ⑤突き合わせ … ③と④が一致しているか
 *
 *   ★④を必ず入れること。
 *     ①〜③は、送る側が自由に書ける「自己申告」です。
 *     「evil.php を image/png と名乗って送る」のは1行で書けます。
 *     中身の頭（マジックバイト）だけは、偽れません。
 *
 *   ★SVG は、画像に見えますが受け付けないこと。
 *     SVG の中には <script> が書けます。つまり画像ではなく、
 *     プログラムです。ブラウザで開けばその場で動きます。
 *     「画像アップロード」から他人のページを乗っ取れてしまいます。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、置き場所を借りずに DB へ入れるのか
 * ═══════════════════════════════════════════════════════
 *
 *   外の置き場所（S3 など）をまだ借りていないからです。
 *   借りていないものを前提に書くと、本番で必ず落ちます。
 *
 *   だから、まずは確実に動く形（DBの中）にします。
 *   あとで外へ移せるように、他の場所から参照するのは
 *   image_id という文字列ひとつだけにしてあります。
 *   移すときに書き換えるのは、このファイルと配信口だけで済みます。
 */

import { createHash } from "node:crypto";
import type { Transaction } from "@libsql/client";

import { appendAuditTx } from "./audit";
import { db, withWriteTx } from "./db";
import { id } from "./ids";

/* ═══════════════════════════════════════════════
   決まりごと
   ═══════════════════════════════════════════════ */

/**
 * 1枚あたりの上限（バイト）。
 *
 * ★大きくしすぎないこと。
 *   写真は DB の1行として読み書きされます。
 *   1枚が大きいほど、一覧を出すたびの通信も遅くなります。
 *   スマホで撮った写真は 2〜4MB ほどなので、
 *   お店には「長辺 1600px 程度に縮めてから」とご案内します。
 */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** 受け付ける形式。ここに無いものは、すべて断ります */
export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageMime = (typeof ALLOWED_MIME)[number];

/** 受け付ける拡張子 */
const ALLOWED_EXT = [".jpg", ".jpeg", ".png", ".webp"];

/** 写真の使いみち */
export type ImageKind = "GACHA_COVER" | "PRIZE";

/* ═══════════════════════════════════════════════
   断り方
   ═══════════════════════════════════════════════ */

/**
 * 受け取れなかった理由。
 *
 * ★理由を、お店に必ず伝えること。
 *   「アップロードに失敗しました」だけだと、
 *   お店は同じ写真を何度も送り直します。直りません。
 *   大きすぎるのか、形式が違うのかが分かれば、その場で直せます。
 */
export class ImageRejected extends Error {
  readonly code = "IMAGE_REJECTED";
  constructor(readonly reason: string) {
    super(reason);
    this.name = "ImageRejected";
  }
}

/* ═══════════════════════════════════════════════
   中身の頭を見る（ここが守りの本体）
   ═══════════════════════════════════════════════ */

const startsWith = (buf: Uint8Array, bytes: number[]) =>
  bytes.length <= buf.length && bytes.every((b, i) => buf[i] === b);

const asciiAt = (buf: Uint8Array, at: number, text: string) => {
  if (at + text.length > buf.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (buf[at + i] !== text.charCodeAt(i)) return false;
  }
  return true;
};

/**
 * バイト列の頭を見て、本当は何の形式なのかを言う。
 * 分からなければ null（＝受け付けない）。
 *
 * ★申告された MIME を、ここでは一切見ないこと。
 *   見てしまうと、申告を信じたのと同じになります。
 */
export function sniffMime(buf: Uint8Array): ImageMime | null {
  /* JPEG は必ず FF D8 FF で始まる */
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "image/jpeg";

  /* PNG は 89 'P' 'N' 'G' CR LF 1A LF の8バイト */
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }

  /* WebP は 'RIFF' ....（4バイトの長さ）.... 'WEBP' */
  if (asciiAt(buf, 0, "RIFF") && asciiAt(buf, 8, "WEBP")) return "image/webp";

  return null;
}

/* ═══════════════════════════════════════════════
   受け取ってよいかを確かめる
   ═══════════════════════════════════════════════ */

export type CheckedImage = {
  mime: ImageMime;
  bytes: number;
  sha256: string;
  data: Uint8Array;
};

/**
 * 送られてきた1枚を、①〜⑤の順に確かめる。
 * 通れば、しまってよい形にして返します。
 */
export function checkImage(input: {
  filename: string;
  declaredMime: string;
  data: Uint8Array;
}): CheckedImage {
  const { filename, declaredMime, data } = input;

  /* ① 大きさ */
  if (data.length === 0) {
    throw new ImageRejected("ファイルの中身が空です。");
  }
  if (data.length > MAX_IMAGE_BYTES) {
    const mb = (MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0);
    throw new ImageRejected(
      `ファイルが大きすぎます（上限 ${mb}MB）。長辺1600px程度に縮めてからお試しください。`,
    );
  }

  /* ② 拡張子 */
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot < 0 ? "" : lower.slice(dot);
  if (!ALLOWED_EXT.includes(ext)) {
    throw new ImageRejected(
      "JPG・PNG・WebP のいずれかを選んでください。",
    );
  }

  /* ★拡張子が二重になっているものを断ること（photo.php.jpg など）。
       置き場所の設定を1つ間違えると、これが実行されます。 */
  const stem = dot < 0 ? lower : lower.slice(0, dot);
  if (/\.(php|phtml|js|mjs|cjs|html?|htm|svg|sh|exe|jsp|asp|aspx|py|rb|pl)$/.test(stem)) {
    throw new ImageRejected("この名前のファイルは受け付けられません。");
  }

  /* ③ 申告された種類 */
  if (!(ALLOWED_MIME as readonly string[]).includes(declaredMime)) {
    throw new ImageRejected(
      "JPG・PNG・WebP のいずれかを選んでください。",
    );
  }

  /* ④ 中身の頭。ここだけは偽れません */
  const real = sniffMime(data);
  if (real == null) {
    throw new ImageRejected(
      "画像として読めませんでした。JPG・PNG・WebP のいずれかを選んでください。",
    );
  }

  /* ⑤ 申告と中身の突き合わせ。
       食い違うということは、名前を偽って送られたということです。 */
  if (real !== declaredMime) {
    throw new ImageRejected(
      "ファイルの中身と種類が一致しません。別のファイルをお試しください。",
    );
  }

  return {
    mime: real,
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
    data,
  };
}

/* ═══════════════════════════════════════════════
   しまう・出す・捨てる
   ═══════════════════════════════════════════════ */

export type SavedImage = {
  id: string;
  mime: ImageMime;
  bytes: number;
  sha256: string;
};

/** 確かめ終わった1枚を、取引の中でしまう */
export async function insertImageTx(
  tx: Transaction,
  input: {
    tenantId: string;
    kind: ImageKind;
    checked: CheckedImage;
    at: string;
    createdBy: string | null;
  },
): Promise<SavedImage> {
  const imageId = id("img");
  await tx.execute({
    sql: `INSERT INTO images
            (id, tenant_id, kind, mime, bytes, sha256, data, created_at, created_by)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [
      imageId,
      input.tenantId,
      input.kind,
      input.checked.mime,
      input.checked.bytes,
      input.checked.sha256,
      input.checked.data,
      input.at,
      input.createdBy,
    ],
  });

  return {
    id: imageId,
    mime: input.checked.mime,
    bytes: input.checked.bytes,
    sha256: input.checked.sha256,
  };
}

/**
 * 1枚を預かる（取引つき）。監査ログにも1行残します。
 */
export async function saveImage(input: {
  tenantId: string;
  kind: ImageKind;
  filename: string;
  declaredMime: string;
  data: Uint8Array;
  actor: { id: string; name: string; role: string };
  requestId?: string;
}): Promise<SavedImage> {
  const checked = checkImage({
    filename: input.filename,
    declaredMime: input.declaredMime,
    data: input.data,
  });

  const at = new Date().toISOString();

  return withWriteTx(async (tx) => {
    const saved = await insertImageTx(tx, {
      tenantId: input.tenantId,
      kind: input.kind,
      checked,
      at,
      createdBy: input.actor.id,
    });

    /* ★写真の中身は、記録に入れないこと。
         残すのは ID・大きさ・種類・指紋までです。 */
    await appendAuditTx(tx, {
      tenantId: input.tenantId,
      at,
      actorKind: "ADMIN",
      actorId: input.actor.id,
      actorName: input.actor.name,
      actorRole: input.actor.role,
      action: "IMAGE_UPLOAD",
      target: `image:${saved.id}`,
      summary: `商品写真を登録しました（${input.kind === "GACHA_COVER" ? "ガチャの表紙" : "賞の写真"}・${Math.round(saved.bytes / 1024)}KB）`,
      data: {
        imageId: saved.id,
        kind: input.kind,
        mime: saved.mime,
        bytes: saved.bytes,
        sha256: saved.sha256,
      },
      requestId: input.requestId,
    });

    return saved;
  });
}

/**
 * 1枚を読み出す。
 *
 * ★必ず tenantId で絞ること。
 *   IDだけで引けるようにすると、他社のIDを1つ言い当てるだけで
 *   まだ公開していない新作の中身が見られます。
 */
export async function readImage(
  tenantId: string,
  imageId: string,
): Promise<{ mime: string; sha256: string; data: Uint8Array } | null> {
  const r = await db().execute({
    sql: `SELECT mime, sha256, data FROM images
           WHERE tenant_id = ? AND id = ?`,
    args: [tenantId, imageId],
  });
  const row = r.rows[0] as unknown as
    | { mime: string; sha256: string; data: unknown }
    | undefined;
  if (!row) return null;

  const raw = row.data;
  const data =
    raw instanceof Uint8Array
      ? raw
      : raw instanceof ArrayBuffer
        ? new Uint8Array(raw)
        : null;
  if (!data) return null;

  return { mime: String(row.mime), sha256: String(row.sha256), data };
}

/**
 * どこからも参照されなくなった写真を、取引の中で本当に消す。
 *
 * ═══════════════════════════════════════════════════════
 * ★売り場から外れても、当選の記録が指していれば消さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   018 から、当たった記録（prizes.image_id）にも
 *   「当たった瞬間の写真」を写し取っています。
 *
 *   ★prizes を数えないと、写真を1回差し替えただけで、
 *     過去に当てた方の履歴の写真が消えます。
 *     お客様から見れば、当てたはずの物が
 *     ある日いきなり「画像なし」に変わります。
 *
 *   ですので、ここで消してよいのは
 *   「売り場からも、過去の当選記録からも、
 *     もう誰も指していない写真」だけです。
 *
 * ═══════════════════════════════════════════════════════
 * ★では、写ってはいけないものが写っていたら
 * ═══════════════════════════════════════════════════════
 *
 *   値札、仕入れ伝票、他のお客様の住所、社員の顔。
 *   こういうものは、当選記録から指されていても消したいはずです。
 *
 *   そのための道は、別に用意してあります（purgeImageHard）。
 *   ★そちらは履歴からも消えます。そのかわり、
 *     誰が・いつ・なぜ消したかが監査に必ず残ります。
 *   静かに消えるのと、記録を残して消すのは、別のことです。
 */
export async function purgeUnusedImageTx(
  tx: Transaction,
  tenantId: string,
  imageId: string | null,
): Promise<void> {
  if (!imageId) return;

  const used = await tx.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM gachas
              WHERE tenant_id = ? AND cover_image_id = ?) AS a,
            (SELECT COUNT(*) FROM gacha_stock
              WHERE tenant_id = ? AND image_id = ?) AS b,
            /* ★これを外さないこと。外すと、差し替えた瞬間に
                 過去に当てた方の履歴の写真が消えます（018） */
            (SELECT COUNT(*) FROM prizes
              WHERE tenant_id = ? AND image_id = ?) AS c`,
    args: [tenantId, imageId, tenantId, imageId, tenantId, imageId],
  });
  const row = used.rows[0] as unknown as { a: number; b: number; c: number };
  if (Number(row.a) + Number(row.b) + Number(row.c) > 0) return;

  await tx.execute({
    sql: `DELETE FROM images WHERE tenant_id = ? AND id = ?`,
    args: [tenantId, imageId],
  });
}

/**
 * 写真を、過去の当選記録からも含めて完全に消す。
 *
 * ═══════════════════════════════════════════════════════
 * ★これは「差し替え」ではありません
 * ═══════════════════════════════════════════════════════
 *
 *   差し替えは、これから売るものの見た目を変えるだけで、
 *   過去に当てた方の履歴は動かしません（それが正しい）。
 *
 *   こちらは、その履歴ごと消します。使うのは1つの場合だけです。
 *
 *       写ってはいけないものが写っていた
 *       （値札・仕入れ伝票・他のお客様の住所・社員の顔）
 *
 *   ★普段の差し替えでこちらを呼ばないこと。
 *     呼んでしまうと、当選の記録が静かに書き換わります。
 *     それはもう、証拠ではありません。
 *
 *   ★呼び出し側は、必ず理由を受け取って監査へ残すこと。
 *     理由の無い完全削除は、あとから誰も説明できません。
 *
 * @returns 履歴から外した件数（当選記録の何件が「写真なし」になったか）
 */
export async function purgeImageHardTx(
  tx: Transaction,
  tenantId: string,
  imageId: string,
): Promise<{ prizesCleared: number; stockCleared: number; coverCleared: number }> {
  /* まず、指している側をすべて外す。
     ★消す順を逆にしないこと。先に写真の行を消すと、
       指したままの行が残り、画面が「壊れた画像」になります。 */
  const cover = await tx.execute({
    sql: `UPDATE gachas SET cover_image_id = NULL
           WHERE tenant_id = ? AND cover_image_id = ?`,
    args: [tenantId, imageId],
  });
  const stock = await tx.execute({
    sql: `UPDATE gacha_stock SET image_id = NULL
           WHERE tenant_id = ? AND image_id = ?`,
    args: [tenantId, imageId],
  });
  const prizes = await tx.execute({
    sql: `UPDATE prizes SET image_id = NULL
           WHERE tenant_id = ? AND image_id = ?`,
    args: [tenantId, imageId],
  });

  await tx.execute({
    sql: `DELETE FROM images WHERE tenant_id = ? AND id = ?`,
    args: [tenantId, imageId],
  });

  return {
    coverCleared: Number(cover.rowsAffected ?? 0),
    stockCleared: Number(stock.rowsAffected ?? 0),
    prizesCleared: Number(prizes.rowsAffected ?? 0),
  };
}

/**
 * 預かった写真が、確かにこの会社のものかを確かめる。
 *
 * ★「この写真をこの商品に付けてください」と言われたときに、必ず通すこと。
 *   通さないと、他社のIDを指定するだけで、
 *   自分の売り場に他社の写真を出せてしまいます。
 */
export async function imageBelongsToTx(
  tx: Transaction,
  tenantId: string,
  imageId: string,
): Promise<boolean> {
  const r = await tx.execute({
    sql: `SELECT 1 FROM images WHERE tenant_id = ? AND id = ? LIMIT 1`,
    args: [tenantId, imageId],
  });
  return r.rows.length > 0;
}
