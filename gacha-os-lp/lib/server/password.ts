/**
 * 合言葉（パスワード）のしまい方。
 *
 * ═══════════════════════════════════════════════════════
 * ★決まり
 * ═══════════════════════════════════════════════════════
 *
 *   1) そのまま保存しない。
 *      DBを一度見られただけで、全員のアカウントが使われます。
 *      しかも、多くの方は他のサービスでも同じ合言葉を使っています。
 *      漏れた被害は、このシステムの外まで広がります。
 *
 *   2) 速い計算で隠さない。
 *      よく使われる SHA-256 は「速いこと」が取り柄です。
 *      速いということは、片っ端から試すのも速いということです。
 *      合言葉には、わざと遅い計算（scrypt）を使います。
 *
 *   3) 人ごとに違う塩（salt）を混ぜる。
 *      混ぜないと、同じ合言葉の人が同じ値になります。
 *      1人ぶん解けたら、同じ値の人が全員まとめて解けます。
 *
 *   4) 照合は timingSafeEqual で行う。
 *      ふつうの比較（===）は、前から順に見て違ったところで止まります。
 *      止まるまでの時間がわずかに変わるので、
 *      その差を測ると、正解の文字が1文字ずつ分かってしまいます。
 *
 * ═══════════════════════════════════════════════════════
 * ★保存する形
 * ═══════════════════════════════════════════════════════
 *
 *   password_hash に、次の形でまとめて入れます。
 *
 *       scrypt$16384$8$1$<塩>$<結果>
 *
 *   計算の強さも一緒に書いておきます。
 *   後で強くしたくなったとき、古い行がどの強さで作られたかが分かり、
 *   その人が次にログインしたときだけ、静かに作り直せます。
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/* いまの強さ。上げるときは N を倍にしていく */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

/** 合言葉として受け付けられるか。理由つきで返す */
export function checkPasswordPolicy(pw: string): { ok: true } | { ok: false; why: string } {
  if (typeof pw !== "string" || pw.length < 10) {
    return { ok: false, why: "パスワードは10文字以上にしてください。" };
  }
  if (pw.length > 200) {
    return { ok: false, why: "パスワードが長すぎます（200文字まで）。" };
  }
  /* ★「大文字・数字・記号を必ず1つ」を強く求めすぎないこと。
       求めるほど Password1! のような似た形に寄ってしまい、
       かえって推測しやすくなります。長さのほうが効きます。 */
  if (/^(\d+|[a-z]+|[A-Z]+)$/.test(pw)) {
    return { ok: false, why: "数字だけ・英字だけのパスワードは使えません。" };
  }
  return { ok: true };
}

/** 合言葉から、保存する文字列を作る */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/**
 * 合言葉が合っているかを確かめる。
 *
 * ★合言葉が未設定の行でも、必ず同じくらい時間をかけること。
 *   未設定のときだけ即座に false を返すと、
 *   返ってくる速さで「この人はまだ登録していない」と分かります。
 */
export async function verifyPassword(pw: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    await scrypt(pw ?? "", randomBytes(16), KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
    return false;
  }

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "base64");
  const want = Buffer.from(parts[5], "base64");
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const got = await scrypt(pw ?? "", salt, want.length, {
    N: n,
    r,
    p,
    maxmem: MAXMEM,
  });
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

/** いまの強さで作られているか（弱ければ、次のログインで作り直す） */
export function needsRehash(stored: string | null | undefined): boolean {
  if (!stored) return true;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return true;
  return Number(parts[1]) < N;
}
