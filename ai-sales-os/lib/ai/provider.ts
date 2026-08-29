import { config, hasSecret, secret } from '../env';

/**
 * AIに考えさせるところの唯一の入口。
 *
 * ★AI_ENABLED=false（初期値）のときは、1回もAPIを叩かない。
 *   代わりにルールベースの解析器で動く。結果が毎回同じになるので、テストと突き合わせられる。
 * ★AIが失敗したら、黙って0や空で埋めない。「AIを使えなかった」と返して、ルール側へ落とす。
 */

export type AiAvailability = {
  enabled: boolean;
  hasKey: boolean;
  model: string;
  engine: 'openai' | 'rule';
  reasonJa: string;
};

export function aiAvailability(): AiAvailability {
  const hasKey = hasSecret('OPENAI_API_KEY');
  const enabled = config.aiEnabled && hasKey;
  return {
    enabled,
    hasKey,
    model: config.openaiModel,
    engine: enabled ? 'openai' : 'rule',
    reasonJa: enabled
      ? 'AIで解析する'
      : !config.aiEnabled
        ? 'AI_ENABLED が false なので、ルールで解析する（課金ゼロ・結果は毎回同じ）'
        : 'APIキーが未設定なので、ルールで解析する',
  };
}

export type AiResult<T> = { ok: true; data: T; engine: 'openai' } | { ok: false; reason: string };

/** JSONで答えさせる。形が違うものが返ってきたら失敗として扱い、勝手に補完しない。 */
export async function askJson<T>(system: string, user: string): Promise<AiResult<T>> {
  const avail = aiAvailability();
  if (!avail.enabled) return { ok: false, reason: avail.reasonJa };
  const key = secret('OPENAI_API_KEY');
  if (!key) return { ok: false, reason: 'APIキーが読めなかった' };

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.openaiModel,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return { ok: false, reason: `AIが${res.status}を返した` };
    const json: any = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return { ok: false, reason: 'AIの返事が空だった' };
    return { ok: true, data: JSON.parse(content) as T, engine: 'openai' };
  } catch (e) {
    return { ok: false, reason: `AIを呼べなかった: ${(e as Error).message}` };
  }
}
