import fs from 'node:fs';
import path from 'node:path';
import { secret, str, STORAGE_DIR } from '../env';

/** StorageProvider — 生成物の保存先。既定はローカル、S3互換へ差し替え可能 */
export interface StorageProvider {
  readonly name: string;
  put(key: string, data: Buffer, mime: string): Promise<{ key: string; url: string }>;
  read(key: string): Promise<{ data: Buffer; mime: string } | null>;
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
};

class LocalStorage implements StorageProvider {
  readonly name = 'local';
  async put(key: string, data: Buffer): Promise<{ key: string; url: string }> {
    const safe = key.replace(/\.\./g, '').replace(/^\/+/, '');
    const abs = path.join(STORAGE_DIR, safe);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
    return { key: safe, url: `/api/files/${safe}` };
  }
  async read(key: string) {
    const safe = key.replace(/\.\./g, '').replace(/^\/+/, '');
    const abs = path.join(STORAGE_DIR, safe);
    if (!fs.existsSync(abs)) return null;
    return { data: fs.readFileSync(abs), mime: MIME_BY_EXT[path.extname(abs).toLowerCase()] || 'application/octet-stream' };
  }
}

class S3Storage implements StorageProvider {
  readonly name = 's3';
  private local = new LocalStorage();
  async put(key: string, data: Buffer, _mime: string) {
    // S3互換にPUT（署名は最小限のAWS4を要するため、鍵が入り次第ここを実装）
    // 現状は取り違えを避けるためローカルへ保存し、S3有効化はキー投入後に切り替える
    return this.local.put(key, data);
  }
  async read(key: string) {
    return this.local.read(key);
  }
}

export function getStorage(): StorageProvider {
  const want = str('STORAGE_PROVIDER', 'local');
  if (want === 's3' && secret('S3_BUCKET')) return new S3Storage();
  return new LocalStorage();
}
