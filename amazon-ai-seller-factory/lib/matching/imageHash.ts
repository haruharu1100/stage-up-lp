import { all, run, nowIso } from '../db/client';

/**
 * 第一段階の「安い画像類似判定」= pHash（知覚ハッシュ）。
 *
 * ・画像を32×32のグレースケールに落とす → 2次元DCT → 左上8×8（直流成分を除く）
 *   → 中央値より上か下かで64ビット → 16桁の16進文字列
 * ・比較はハミング距離だけ。AI課金は一切かからない。
 * ・1度計算したURLはDBに保存し、二度と取りに行かない。
 *
 * ★ここで「似ている」と分かっても、それだけで同一商品と断定してはいけない。
 *   最終判断は MATCH SCORE（型番・JAN・サイズ・仕様）と合わせて行う。
 */

const HASH_BITS = 64;
const SAMPLE_PREFIX = 'sample://';

let jimpMod: any | null | undefined;

async function loadJimp(): Promise<any | null> {
  if (jimpMod !== undefined) return jimpMod;
  try {
    // 動的読み込み。未導入でもビルドは通る（その場合は画像点を0にする）
    const mod = await import('jimp');
    jimpMod = (mod as any).default ?? mod;
  } catch {
    jimpMod = null;
  }
  return jimpMod;
}

export async function imageDecoderAvailable(): Promise<boolean> {
  return (await loadJimp()) !== null;
}

// ---- DCT-II（32点）----------------------------------------------
const N = 32;
const COS: number[][] = (() => {
  const t: number[][] = [];
  for (let u = 0; u < N; u++) {
    t[u] = [];
    for (let x = 0; x < N; x++) t[u][x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N));
  }
  return t;
})();

function dct2d(pixels: number[][]): number[][] {
  const tmp: number[][] = [];
  for (let y = 0; y < N; y++) {
    tmp[y] = [];
    for (let u = 0; u < N; u++) {
      let s = 0;
      for (let x = 0; x < N; x++) s += pixels[y][x] * COS[u][x];
      tmp[y][u] = s * (u === 0 ? Math.SQRT1_2 : 1);
    }
  }
  const out: number[][] = [];
  for (let v = 0; v < N; v++) {
    out[v] = [];
    for (let u = 0; u < N; u++) {
      let s = 0;
      for (let y = 0; y < N; y++) s += tmp[y][u] * COS[v][y];
      out[v][u] = s * (v === 0 ? Math.SQRT1_2 : 1);
    }
  }
  return out;
}

/** 画像バイト列 → 64bit pHash（16進16桁）。失敗時 null */
export async function perceptualHash(buffer: Buffer): Promise<string | null> {
  const Jimp = await loadJimp();
  if (!Jimp) return null;
  try {
    const img = await Jimp.read(buffer);
    img.greyscale().resize(N, N);
    const px: number[][] = [];
    for (let y = 0; y < N; y++) {
      px[y] = [];
      for (let x = 0; x < N; x++) {
        const idx = img.getPixelIndex(x, y);
        px[y][x] = img.bitmap.data[idx]; // greyscale なので R でよい
      }
    }
    const d = dct2d(px);
    const vals: number[] = [];
    for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) if (!(u === 0 && v === 0)) vals.push(d[v][u]);
    const sorted = [...vals].sort((a, b) => a - b);
    const median = (sorted[Math.floor(sorted.length / 2) - 1] + sorted[Math.floor(sorted.length / 2)]) / 2;
    // 63個 + 先頭に1ビット足して64ビットにする
    const bits = [d[0][1] > median, ...vals.map((v) => v > median)].slice(0, HASH_BITS);
    let hex = '';
    for (let i = 0; i < HASH_BITS; i += 4) {
      let nib = 0;
      for (let j = 0; j < 4; j++) if (bits[i + j]) nib |= 1 << (3 - j);
      hex += nib.toString(16);
    }
    return hex;
  } catch {
    return null;
  }
}

// ---- 取得（キャッシュ付き）----------------------------------------

const memo = new Map<string, string | null>();

async function cachedHash(url: string): Promise<string | null> {
  if (memo.has(url)) return memo.get(url) ?? null;
  const rows = await all(`SELECT hash, ok FROM image_hashes WHERE url = ?`, [url]);
  if (rows.length) {
    const h = rows[0].ok ? (rows[0].hash as string | null) : null;
    memo.set(url, h);
    return h;
  }
  return undefined as unknown as string | null;
}

async function saveHash(url: string, hash: string | null, error?: string) {
  memo.set(url, hash);
  await run(
    `INSERT INTO image_hashes (url, hash, ok, error, fetched_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET hash = excluded.hash, ok = excluded.ok, error = excluded.error, fetched_at = excluded.fetched_at`,
    [url, hash, hash ? 1 : 0, error ?? null, nowIso()],
  );
}

/**
 * 画像URLから pHash を得る。
 * ・キャッシュ済みならネットワークに出ない
 * ・sample:// はサンプル用の擬似URL（実際の取得はしない）
 */
export async function hashFromUrl(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith(SAMPLE_PREFIX)) return null; // サンプルは listing.imageHash を使う
  const cached = await cachedHash(url);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      await saveHash(url, null, `HTTP ${res.status}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const h = await perceptualHash(buf);
    await saveHash(url, h, h ? undefined : 'デコードできませんでした');
    return h;
  } catch (e: any) {
    await saveHash(url, null, String(e?.message ?? e).slice(0, 120));
    return null;
  }
}

/** 事前計算済みハッシュがあればそれを、無ければURLから計算する */
export async function resolveHash(precomputed: string | null | undefined, urls: string[]): Promise<string | null> {
  if (precomputed && /^[0-9a-f]{16}$/i.test(precomputed)) return precomputed.toLowerCase();
  for (const u of urls.slice(0, 2)) {
    const h = await hashFromUrl(u);
    if (h) return h;
  }
  return null;
}

// ---- 比較 --------------------------------------------------------

export function hammingDistance(a: string, b: string): number | null {
  if (!a || !b || a.length !== b.length) return null;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    d += ((x >> 3) & 1) + ((x >> 2) & 1) + ((x >> 1) & 1) + (x & 1);
  }
  return d;
}

/** 0〜1の類似度。距離0で1.0、距離22以上で0 */
export function imageSimilarity(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const d = hammingDistance(a, b);
  if (d === null) return null;
  const sim = 1 - d / 22;
  return Math.max(0, Math.min(1, sim));
}
