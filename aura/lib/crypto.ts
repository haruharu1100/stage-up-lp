import crypto from "crypto";
import { env } from "./env";

// トークン暗号化（AES-256-GCM）。
// 保存形式: base64( iv[12] | authTag[16] | ciphertext )
// 鍵は TOKEN_ENCRYPTION_KEY を SHA-256 で 32バイトに正規化（長さを問わない）。

function key(): Buffer {
  if (!env.tokenEncryptionKey) {
    throw new Error("TOKEN_ENCRYPTION_KEY が未設定です");
  }
  return crypto.createHash("sha256").update(env.tokenEncryptionKey).digest();
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decrypt(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
