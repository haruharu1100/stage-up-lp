import crypto from 'node:crypto';

/** パスワード・PINは元に戻せない形でしか保存しない（scrypt + 個別ソルト） */
export function hashSecret(plain) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(plain), salt, 32);
  return `scrypt$${salt.toString('hex')}$${dk.toString('hex')}`;
}

export function verifySecret(plain, stored) {
  if (!stored) return false;
  const [algo, saltHex, hashHex] = String(stored).split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const dk = crypto.scryptSync(String(plain), Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(hashHex, 'hex');
  return dk.length === expected.length && crypto.timingSafeEqual(dk, expected);
}
