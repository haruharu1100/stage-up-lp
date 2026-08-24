import { all, run, nowIso } from '../db/client';
import { config, secret, str } from '../env';
import { withProviderHealth } from '../ops/providerHealth';

/**
 * EmbeddingProvider — 第二段階の「画像Embedding／テキストEmbedding」。
 *
 * ★費用の考え方
 *   ここは pHash とテキスト類似で絞り切れなかった商品にだけ使う。
 *   1回計算したら必ずDBに保存し、同じ文字列で二度課金しない。
 */
export interface EmbeddingProvider {
  readonly name: string;
  readonly isReal: boolean;
  readonly model: string;
  embed(texts: string[]): Promise<(number[] | null)[]>;
}

class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'mock';
  readonly isReal = false;
  readonly model = 'none';
  async embed(texts: string[]) {
    // ★偽のベクトルを返して「似ている」と誤判定させない。必ず null。
    return texts.map(() => null);
  }
}

class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly isReal = true;
  readonly model: string;
  constructor(private key: string) {
    this.model = str('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small');
  }
  async embed(texts: string[]): Promise<(number[] | null)[]> {
    if (!texts.length) return [];
    // ★成功・失敗を記録する（連続で失敗したら DOWN 扱いになり、しばらく呼ばなくなる）
    return withProviderHealth('openai_embedding', async () => {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json: any = await res.json();
      const out: (number[] | null)[] = texts.map(() => null);
      for (const d of json.data || []) out[d.index] = d.embedding;
      return out;
    });
  }
}

export function getEmbeddingProvider(): EmbeddingProvider {
  const want = str('EMBEDDING_PROVIDER', 'auto');
  if (config.offline || want === 'mock' || want === 'none') return new MockEmbeddingProvider();
  const key = secret('OPENAI_API_KEY');
  if (want === 'openai') return key ? new OpenAiEmbeddingProvider(key) : new MockEmbeddingProvider();
  return key ? new OpenAiEmbeddingProvider(key) : new MockEmbeddingProvider();
}

// ---- キャッシュ付きの入口 -------------------------------------------

function keyOf(model: string, text: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `${model}:${text.length}:${h.toString(36)}`;
}

/**
 * 2つの文章の類似度（0〜1）。埋め込みが使えない時は null。
 * @returns similarity と「実際に課金APIを呼んだ回数」
 */
export async function textSimilarityByEmbedding(
  a: string,
  b: string,
): Promise<{ similarity: number | null; paidCalls: number }> {
  const provider = getEmbeddingProvider();
  if (!provider.isReal) return { similarity: null, paidCalls: 0 };

  const need: string[] = [];
  const vectors: (number[] | null)[] = [];
  for (const t of [a, b]) {
    const k = keyOf(provider.model, t);
    const rows = await all(`SELECT vector FROM embedding_cache WHERE key = ?`, [k]);
    if (rows.length) {
      try {
        vectors.push(JSON.parse(String(rows[0].vector)));
      } catch {
        vectors.push(null);
      }
    } else {
      vectors.push(null);
      need.push(t);
    }
  }

  let paidCalls = 0;
  if (need.length) {
    try {
      const fresh = await provider.embed(need);
      paidCalls = 1;
      for (let i = 0; i < need.length; i++) {
        const v = fresh[i];
        if (!v) continue;
        await run(
          `INSERT INTO embedding_cache (key, model, vector, created_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET vector = excluded.vector`,
          [keyOf(provider.model, need[i]), provider.model, JSON.stringify(v), nowIso()],
        );
      }
      // 埋め直し
      for (let i = 0; i < 2; i++) {
        if (vectors[i]) continue;
        const idx = need.indexOf(i === 0 ? a : b);
        if (idx >= 0) vectors[i] = fresh[idx] ?? null;
      }
    } catch {
      return { similarity: null, paidCalls: 0 };
    }
  }

  if (!vectors[0] || !vectors[1]) return { similarity: null, paidCalls };
  return { similarity: cosine(vectors[0]!, vectors[1]!), paidCalls };
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
