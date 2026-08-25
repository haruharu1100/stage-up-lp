/**
 * ID の作り方。
 *
 * ═══════════════════════════════════════════════════════
 * ★連番をやめた理由
 * ═══════════════════════════════════════════════════════
 *
 *   これまで会員IDや景品IDは、配列の長さから作っていました（pz_01, pz_02 …）。
 *   短くて読みやすいのですが、次のことが起きます。
 *
 *     ・自分のIDが pz_37 なら、pz_36 や pz_38 が存在すると分かる
 *     ・順に叩けば、他の方の分がどれだけあるかが数えられる
 *     ・「今日は何件売れたか」が、IDを1つ見るだけで外から分かる
 *
 *   そこで、中で使うIDは推測できないもの（ULID）にします。
 *
 * ═══════════════════════════════════════════════════════
 * ★画面に出す番号は別に持つ
 * ═══════════════════════════════════════════════════════
 *
 *   26文字の英数字を電話口で読み上げるのは無理があります。
 *   だから「GD-0001」のような短い番号も別に持ちます。
 *
 *   ★ただし、権限の判定に短い番号を使わないこと。
 *     「この景品はあなたのものか」の判定は、必ず中のID同士で行います。
 *     短い番号は、人が見分けるためだけのものです。
 */

import { randomBytes } from "node:crypto";

/* Crockford Base32。まぎらわしい I・L・O・U を外してある */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * ULID を作る。
 *
 * 前半10文字が時刻（ミリ秒）、後半16文字が乱数。
 * 時刻が前にあるので、並べ替えるとだいたい作った順になります。
 * 後半は暗号用の乱数なので、隣のIDを言い当てることはできません。
 */
export function ulid(now: number = Date.now()): string {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }

  const bytes = randomBytes(16);
  let rand = "";
  for (let i = 0; i < 16; i++) rand += ALPHABET[bytes[i] % 32];

  return time + rand;
}

/** 種類が分かる接頭辞つきのID（cus_01J…, drw_01J… のような形） */
export function id(prefix: string): string {
  return `${prefix}_${ulid()}`;
}

/** 画面に出す番号。GD-0001 のような形 */
export function displayNo(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(4, "0")}`;
}
