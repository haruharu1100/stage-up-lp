import { config, secret, str } from '../env';
import { withProviderHealth } from '../ops/providerHealth';

/**
 * VisionProvider — 多段階照合の【第四段階】。最後の最後だけ使う高性能AI。
 *
 * ★絶対のルール
 *   ・全商品には絶対に使わない。安い処理（型番・pHash・属性）で
 *     絞り切れなかった「有望かつ判定が割れた候補」だけに使う。
 *   ・呼び出し回数は RESEARCH_MAX_VISION_CALLS で上限を持つ。
 *   ・鍵が無い時は「分からない（unknown）」を返す。勝手に「同一」と言わない。
 */

export interface VisionVerdict {
  verdict: 'same' | 'different' | 'unknown';
  /** 0〜1 */
  confidence: number;
  reason: string;
  /** 課金が発生したか */
  paid: boolean;
}

export interface VisionProvider {
  readonly name: string;
  readonly isReal: boolean;
  readonly model: string;
  /** 2枚の商品画像＋商品情報を見て、同一商品かを判定する */
  compareProducts(input: {
    supplierImageUrl: string | null;
    amazonImageUrl: string | null;
    supplierText: string;
    amazonText: string;
  }): Promise<VisionVerdict>;
}

class MockVisionProvider implements VisionProvider {
  readonly name = 'mock';
  readonly isReal = false;
  readonly model = 'none';
  async compareProducts(): Promise<VisionVerdict> {
    return {
      verdict: 'unknown',
      confidence: 0,
      reason: 'OPENAI_API_KEY が無いため画像の最終確認は行っていません（推測で「同一」とは判定しません）',
      paid: false,
    };
  }
}

const PROMPT = `あなたはAmazon物販の商品同定の専門家です。
2つの商品（A=海外仕入先の商品 / B=Amazonで販売中の商品）が「まったく同じ製品」かを判定してください。

判定の原則:
- 見た目が似ているだけでは「同じ」と言わないこと。形・色・容量・内容量・セット個数・素材・仕様がすべて一致する必要があります。
- 同じ工場のOEM品でブランド名だけ違う場合は「同じ製品」と扱ってよい。
- 少しでも仕様が違う（容量違い・セット数違い・世代違い）なら different。
- 情報が足りず判断できないときは必ず unknown。

必ず次のJSONだけを返してください:
{"verdict":"same|different|unknown","confidence":0.0〜1.0,"reason":"日本語で60字以内"}`;

/** 本物の画像URLか（sample:// などの擬似URLは false） */
function usableImageUrl(u: string | null): u is string {
  return !!u && /^https?:\/\//.test(u);
}

class OpenAiVisionProvider implements VisionProvider {
  readonly name = 'openai';
  readonly isReal = true;
  readonly model: string;
  constructor(private key: string) {
    this.model = str('OPENAI_VISION_MODEL', 'gpt-4o-mini');
  }

  async compareProducts(input: {
    supplierImageUrl: string | null;
    amazonImageUrl: string | null;
    supplierText: string;
    amazonText: string;
  }): Promise<VisionVerdict> {
    // ★両側に本物の画像が無いなら、これは「画像確認」ではない。
    //   文章だけを見て「別商品だ」と言い切るのは危険なので、呼ばずに unknown を返す。
    //   （sample:// のような擬似URLもここで弾かれる）
    if (!usableImageUrl(input.supplierImageUrl) || !usableImageUrl(input.amazonImageUrl)) {
      return {
        verdict: 'unknown',
        confidence: 0,
        reason: '両方の商品画像がそろっていないため、画像での最終確認は行っていません',
        paid: false,
      };
    }

    const content: any[] = [
      { type: 'text', text: `A（仕入先）: ${input.supplierText}` },
      { type: 'text', text: `B（Amazon）: ${input.amazonText}` },
      { type: 'image_url', image_url: { url: input.supplierImageUrl } },
      { type: 'image_url', image_url: { url: input.amazonImageUrl } },
    ];

    try {
      // ★成功・失敗を記録する（連続で失敗したら DOWN 扱いになり、しばらく呼ばなくなる）
      const json: any = await withProviderHealth('openai_vision', async () => {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: 'system', content: PROMPT },
              { role: 'user', content },
            ],
            response_format: { type: 'json_object' },
            max_tokens: 200,
          }),
          signal: AbortSignal.timeout(90_000),
        });
        if (!res.ok) throw new Error(`画像確認AIの呼び出しに失敗（${res.status}）`);
        return res.json();
      });
      const text = json.choices?.[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(text);
      const v = parsed.verdict === 'same' || parsed.verdict === 'different' ? parsed.verdict : 'unknown';
      return {
        verdict: v,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        reason: String(parsed.reason || '').slice(0, 120),
        paid: true,
      };
    } catch (e: any) {
      return { verdict: 'unknown', confidence: 0, reason: `画像確認AIでエラー: ${String(e?.message ?? e).slice(0, 80)}`, paid: false };
    }
  }
}

export function getVisionProvider(): VisionProvider {
  const want = str('VISION_PROVIDER', 'auto');
  if (config.offline || want === 'mock' || want === 'none') return new MockVisionProvider();
  const key = secret('OPENAI_API_KEY');
  return key ? new OpenAiVisionProvider(key) : new MockVisionProvider();
}
