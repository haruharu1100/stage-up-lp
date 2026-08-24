import Anthropic from '@anthropic-ai/sdk';
import { config, secret, str } from '../env';
import { withProviderHealth } from '../ops/providerHealth';

/**
 * LLMProvider — 文章系AIの差し替え口。
 * 鍵が無い/OFFLINE_MODE の時は mock が返るので、システム全体は必ず動く。
 */
export interface LlmRequest {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LlmResponse {
  text: string;
  provider: string;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly isReal: boolean;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

/** 全プロンプト共通の絶対ルール。虚偽・誇大・薬機法違反の生成を止める */
export const LLM_GUARDRAILS = `
【絶対に守るルール】
1. 与えられた事実（商品情報・レビュー・数値）に無いことを作らない。不明な点は「不明」と書く。
2. 景品表示法：優良誤認・有利誤認になる表現は禁止。「必ず」「絶対」「日本一」「No.1」「最安値」「業界唯一」等の
   根拠のない断定・最上級表現を使わない。二重価格やカウントダウンで購入を急がせる表現も禁止。
3. 医薬品医療機器等法（薬機法）：食品・日用品に対して、病気の治療・予防・診断、身体機能の改善、
   「効く」「治る」「免疫力アップ」「デトックス」「痩せる」等の表現を使わない。
4. 食品の健康効果・栄養機能の主張は、届出や表示許可がある場合のみ。無い場合は一切書かない。
5. 存在しない性能・成分・受賞・認証・産地を作らない。
6. 他社の商標・キャラクター名・ブランド名を無断で使わない。
7. 出力は指定されたJSON形式のみ。前置き・言い訳・マークダウンのコードフェンスを付けない。
`.trim();

class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly isReal = true;
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
    this.model = str('ANTHROPIC_MODEL', 'claude-sonnet-4-6');
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 4000,
      temperature: req.temperature ?? 0.4,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    });
    const text = res.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim();
    return {
      text,
      provider: this.name,
      model: this.model,
      tokensIn: res.usage?.input_tokens,
      tokensOut: res.usage?.output_tokens,
    };
  }
}

class OpenAiProvider implements LlmProvider {
  readonly name = 'openai';
  readonly isReal = true;
  private apiKey: string;
  private model: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.model = str('OPENAI_TEXT_MODEL', 'gpt-5.6-sol');
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    // ★成功・失敗を記録する（連続で失敗したら DOWN 扱いになり、しばらく呼ばなくなる）
    return withProviderHealth('openai_text', async () => {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
        }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) {
        throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const json: any = await res.json();
      return {
        text: (json.choices?.[0]?.message?.content || '').trim(),
        provider: this.name,
        model: this.model,
        tokensIn: json.usage?.prompt_tokens,
        tokensOut: json.usage?.completion_tokens,
      };
    });
  }
}

/**
 * 鍵が無い時の代役。JSONの「形」だけを返し、値には必ず MOCK 印を付ける。
 * ※これは検証用のダミーであり、この文章をそのまま出品してはいけない。
 */
class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';
  readonly isReal = false;

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const skeleton = extractJsonSkeleton(req.user);
    return { text: skeleton, provider: this.name, model: 'mock-v1' };
  }
}

/** プロンプト内の「出力JSON例」を拾ってそのまま返す（mock用） */
function extractJsonSkeleton(user: string): string {
  const marker = user.indexOf('__MOCK_JSON__');
  if (marker >= 0) {
    const body = user.slice(marker + '__MOCK_JSON__'.length).trim();
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start) return body.slice(start, end + 1);
  }
  return '{}';
}

export function getLlmProvider(): LlmProvider {
  const want = str('LLM_PROVIDER', 'auto');
  if (config.offline || want === 'mock') return new MockLlmProvider();

  const anthropicKey = secret('ANTHROPIC_API_KEY');
  const openaiKey = secret('OPENAI_API_KEY');

  if (want === 'anthropic') return anthropicKey ? new AnthropicProvider(anthropicKey) : new MockLlmProvider();
  if (want === 'openai') return openaiKey ? new OpenAiProvider(openaiKey) : new MockLlmProvider();

  if (anthropicKey) return new AnthropicProvider(anthropicKey);
  if (openaiKey) return new OpenAiProvider(openaiKey);
  return new MockLlmProvider();
}

/** JSONを必ず取り出す。壊れていたら最初の { 〜 最後の } を切り出して再挑戦 */
export function parseLlmJson<T>(text: string, fallback: T): T {
  const cleaned = text
    .replace(/^```(?:json)?/gm, '')
    .replace(/```$/gm, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        /* fallthrough */
      }
    }
    return fallback;
  }
}
