/** どのX投稿から売れたかを追えるようにする。全URLにUTMを付ける。 */
export type UtmParts = {
  source: string; // x / note / mail など
  medium: string; // social / referral / email
  campaign: string; // ai_sales_001（案件ごとに固定）
  content: string; // post_004（投稿ごとに固定）
};

export function campaignId(ideaId: string, seq: number): string {
  const short = ideaId.replace(/^idea_/, '').slice(0, 6);
  return `ai_${short}_${String(seq).padStart(3, '0')}`;
}

export function contentId(kind: string, seq: number): string {
  return `${kind}_${String(seq).padStart(3, '0')}`;
}

export function buildUtm(parts: UtmParts): string {
  const q = new URLSearchParams({
    utm_source: parts.source,
    utm_medium: parts.medium,
    utm_campaign: parts.campaign,
    utm_content: parts.content,
  });
  return q.toString();
}

export function withUtm(url: string, parts: UtmParts): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${buildUtm(parts)}`;
}

export function parseUtm(url: string): Partial<UtmParts> {
  try {
    const u = new URL(url);
    return {
      source: u.searchParams.get('utm_source') ?? undefined,
      medium: u.searchParams.get('utm_medium') ?? undefined,
      campaign: u.searchParams.get('utm_campaign') ?? undefined,
      content: u.searchParams.get('utm_content') ?? undefined,
    };
  } catch {
    return {};
  }
}
