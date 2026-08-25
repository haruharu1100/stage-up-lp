/**
 * 二段階認証（TOTP）。スマホの認証アプリに出る6桁の数字です。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ必要か
 * ═══════════════════════════════════════════════════════
 *
 *   管理者のパスワードが1つ漏れると、その会社の
 *   会員・売上・ポイント・発送が全部動かせます。
 *   パスワードは、使い回し・のぞき見・偽サイトで、実際に漏れます。
 *
 *   6桁の数字を足すと、パスワードが漏れても、
 *   手元のスマホが無ければ入れません。
 *
 * ═══════════════════════════════════════════════════════
 * ★決まり
 * ═══════════════════════════════════════════════════════
 *
 *   1) 前後の30秒も受け付けること。
 *      スマホとサーバーの時計は、必ず少しずれています。
 *      きっかり同じ30秒しか受け付けないと、
 *      正しい数字なのに入れない人が出ます。
 *      そうなると「面倒だから二段階認証を切ろう」になります。
 *
 *   2) ただし、広げすぎないこと。
 *      前後1つ（±30秒）までにします。
 *      広げるほど、当てずっぽうが当たりやすくなります。
 *
 *   3) 一度使った数字は、同じ30秒の間は二度と使えないこと。
 *      使えると、肩越しに見られた数字がそのまま使えます。
 *      最後に通した時間帯を保存して、同じなら断ります。
 *
 *   4) 照合は timingSafeEqual で行うこと。
 *      ふつうの比較は、違ったところで止まります。
 *      止まるまでの時間差から、正解が1桁ずつ分かります。
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 1つの数字が有効な長さ（秒）。世の中の認証アプリは30秒 */
export const STEP_SECONDS = 30;

/** 何桁か */
const DIGITS = 6;

/** 前後いくつまで許すか。1 = 前後30秒まで */
const WINDOW = 1;

/* ══════════════════════════════════════════════
   BASE32（認証アプリに渡す形）
   ══════════════════════════════════════════════ */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < buf.length; i += 1) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * 新しい合言葉のもと（secret）を作る。
 *
 * ★予測できる値から作らないこと。
 *   時刻やメールアドレスから作ると、同じ手順で誰でも作れます。
 */
export function newMfaSecret(): string {
  return base32Encode(randomBytes(20));
}

/** 認証アプリに読ませるための文字列（QRコードの中身） */
export function mfaUri(input: {
  secret: string;
  account: string;
  issuer: string;
}): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const q = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}

/** いまが何番目の30秒か */
export function counterAt(atMs: number): number {
  return Math.floor(atMs / 1000 / STEP_SECONDS);
}

/** その30秒に出るはずの6桁を計算する */
export function codeFor(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const mac = createHmac("sha1", key).update(buf).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);

  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

export type MfaResult =
  | { ok: true; counter: number }
  | { ok: false; why: "FORMAT" | "MISMATCH" | "REUSED" };

/**
 * 入力された6桁が合っているか。
 *
 * @param lastCounter  最後に通した30秒の番号。
 *                     ★必ず渡して、必ず保存し直すこと。
 *                       渡さないと、同じ数字を何度でも使えます。
 */
export function verifyMfa(input: {
  secret: string | null | undefined;
  code: string | undefined;
  atMs?: number;
  lastCounter?: number | null;
}): MfaResult {
  const raw = (input.code ?? "").replace(/\s/g, "");
  if (!input.secret || !/^\d{6}$/.test(raw)) return { ok: false, why: "FORMAT" };

  const now = counterAt(input.atMs ?? Date.now());
  const got = Buffer.from(raw, "utf8");

  for (let d = -WINDOW; d <= WINDOW; d += 1) {
    const counter = now + d;
    const want = Buffer.from(codeFor(input.secret, counter), "utf8");
    if (want.length !== got.length) continue;
    if (!timingSafeEqual(want, got)) continue;

    /* ★合っていても、すでに使った時間帯なら断ること */
    if (input.lastCounter != null && counter <= input.lastCounter) {
      return { ok: false, why: "REUSED" };
    }
    return { ok: true, counter };
  }
  return { ok: false, why: "MISMATCH" };
}
