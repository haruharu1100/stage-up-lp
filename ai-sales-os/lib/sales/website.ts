/**
 * 会社の公式ホームページを「読むだけ」読む。
 *
 * ★何をしないか（ここが大事）
 *   ・フォームの送信はしない。POSTを出す処理コードがこのファイルに無い。
 *   ・ログインが要るページは見ない。
 *   ・robots.txt で断られている場所は読まない。読めなかったときも読まない（分からないものは通さない）。
 *   ・1社につき最大3ページまで。トップと「会社概要」「お問い合わせ」だけ。
 *   ・同じサイトへ続けて当たらない（既定1.5秒あける）。相手のサーバーに負担をかけないため。
 *   ・取ってきたHTMLは保存しない。文章に直して、必要な部分だけを残す。
 *
 * ★なぜ公式HPを読むのか
 *   会社の登記情報（法人番号・gBizINFO）だけでは「何をしている会社か」が分からない。
 *   分からないまま営業文を書くと、どの会社にも同じ文面を送ることになる。
 *   公式HPは、その会社自身が公開している文章なので、そこに書いてあることだけを引用する。
 */

import { hostOf, isOwnSiteUrl, sameOrganization } from '../text';

export const WEBSITE_UA = 'ai-sales-os-reader/1.0 (read-only; respects robots.txt)';
/** 1ページの読み取り上限。これ以上は読まない。 */
export const MAX_BYTES = 400_000;
/** 1社あたりに見るページ数の上限。 */
export const MAX_PAGES_PER_COMPANY = 3;
/** 同じサイトへ当たる間隔（ミリ秒）。robots.txt に Crawl-delay があればそちらを優先。 */
export const DEFAULT_DELAY_MS = 1_500;
const TIMEOUT_MS = 20_000;

export type PageRead = {
  ok: boolean;
  url: string;
  status: number | null;
  title: string | null;
  text: string;
  /** 読めなかったときの理由。読めたときも「なぜ読めたか」を入れる。 */
  reason: string;
  /** ページ内のリンク（同じサイトのものだけ）。 */
  links: { url: string; label: string }[];
  /**
   * 生のHTML（先頭のみ）。
   * ★用途は1つだけ：フォームにCAPTCHA・ログインがあるかを見るため。
   *   本文として使わない（文章は text を使う）。回避のためには使わない。
   */
  html: string;
};

// ── robots.txt ────────────────────────────────────────────────

export type RobotsRules = {
  /** 読んでよいか判断できる状態か。false のときは何も読まない。 */
  usable: boolean;
  reason: string;
  allow: string[];
  disallow: string[];
  crawlDelayMs: number;
  /** robots.txt が自分から教えてくれている目次（sitemap.xml）の場所。 */
  sitemaps: string[];
};

const robotsCache = new Map<string, RobotsRules>();
const lastHitAt = new Map<string, number>();

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** robots.txt の中身を、うちのUAに当てはまる規則だけに絞って読む。 */
export function parseRobots(body: string): { allow: string[]; disallow: string[]; crawlDelayMs: number; sitemaps: string[] } {
  const lines = body.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim());
  const sitemaps: string[] = [];
  // 「*」向けの規則と、うちのUA名を名指しした規則を分けて集め、名指しがあればそちらを使う。
  const groups: { agents: string[]; allow: string[]; disallow: string[]; delay: number | null }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const field = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (field === 'sitemap') {
      if (/^https?:\/\//i.test(value)) sitemaps.push(value);
      continue;
    }
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], allow: [], disallow: [], delay: null };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (field === 'disallow') cur.disallow.push(value);
    else if (field === 'allow') cur.allow.push(value);
    else if (field === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) cur.delay = n * 1000;
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => WEBSITE_UA.toLowerCase().startsWith(a) || a === 'ai-sales-os-reader'));
  const star = groups.filter((g) => g.agents.includes('*'));
  const picked = mine.length > 0 ? mine : star;
  return {
    allow: picked.flatMap((g) => g.allow).filter((v) => v !== ''),
    disallow: picked.flatMap((g) => g.disallow).filter((v) => v !== ''),
    crawlDelayMs: Math.max(DEFAULT_DELAY_MS, ...picked.map((g) => g.delay ?? 0)),
    sitemaps,
  };
}

/** 一番長く当てはまった規則が勝つ（robots.txt の決まり）。 */
export function robotsAllowsPath(rules: RobotsRules, path: string): boolean {
  if (!rules.usable) return false;
  const match = (pattern: string): number => {
    // 「*」と行末の「$」だけを見る。それ以上は踏み込まない。
    const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const re = new RegExp(`^${esc.endsWith('\\$') ? `${esc.slice(0, -2)}$` : esc}`);
    return re.test(path) ? pattern.length : -1;
  };
  const a = Math.max(-1, ...rules.allow.map(match));
  const d = Math.max(-1, ...rules.disallow.map(match));
  if (d < 0) return true;
  return a >= d;
}

export async function loadRobots(url: string): Promise<RobotsRules> {
  const origin = originOf(url);
  if (!origin) return { usable: false, reason: 'URLの形になっていない', allow: [], disallow: [], crawlDelayMs: DEFAULT_DELAY_MS, sitemaps: [] };
  const cached = robotsCache.get(origin);
  if (cached) return cached;

  let rules: RobotsRules;
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { 'User-Agent': WEBSITE_UA, Accept: 'text/plain' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404 || res.status === 410) {
      // 決まりが置かれていない＝制限なし、というのが robots.txt の決まり。
      rules = { usable: true, reason: 'robots.txt が無い（制限なし）', allow: [], disallow: [], crawlDelayMs: DEFAULT_DELAY_MS, sitemaps: [] };
    } else if (res.ok) {
      const body = (await res.text()).slice(0, MAX_BYTES);
      const p = parseRobots(body);
      rules = { usable: true, reason: 'robots.txt を読んだ', ...p };
    } else {
      // 読めない＝断られているものとして扱う。分からないものは通さない。
      rules = { usable: false, reason: `robots.txt が${res.status}を返したので読まない`, allow: [], disallow: [], crawlDelayMs: DEFAULT_DELAY_MS, sitemaps: [] };
    }
  } catch (e) {
    rules = { usable: false, reason: `robots.txt を取れなかったので読まない（${(e as Error).message}）`, allow: [], disallow: [], crawlDelayMs: DEFAULT_DELAY_MS, sitemaps: [] };
  }
  robotsCache.set(origin, rules);
  return rules;
}

/** テスト用。覚えている robots.txt を捨てる。 */
export function resetRobotsCache(): void {
  robotsCache.clear();
  lastHitAt.clear();
}

// ── HTML → 文章 ───────────────────────────────────────────────

export function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m) return decodeEntities(m[1]).replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  const og = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  return og ? decodeEntities(og[1]).trim().slice(0, 200) || null : null;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

/** HTMLをただの文章にする。台本・見た目の指定は落とす。 */
export function htmlToText(html: string): string {
  const meta = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(`${meta ? `${meta[1]}\n` : ''}${body}`)
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractLinks(html: string, baseUrl: string): { url: string; label: string }[] {
  const out: { url: string; label: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)) {
    let abs: string;
    try {
      abs = new URL(m[1], baseUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:/.test(abs)) continue;
    if (!sameOrganization(baseUrl, abs)) continue;
    out.push({ url: abs.split('#')[0], label: decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() });
  }
  return out;
}

const ABOUT_WORDS = ['会社概要', '企業情報', '会社案内', '私たち', 'about', 'company', '事業内容', '業務内容', 'service', 'サービス'];
const CONTACT_WORDS = ['お問い合わせ', 'お問合せ', '問い合わせ', 'contact', 'inquiry', 'ご相談'];

/** 「会社概要」「お問い合わせ」のリンクを1つずつ選ぶ。無ければ null。 */
export function pickSubPages(links: { url: string; label: string }[], topUrl: string): { about: string | null; contact: string | null } {
  const score = (l: { url: string; label: string }, words: string[]) => {
    const hay = `${l.label} ${l.url}`.toLowerCase();
    return words.some((w) => hay.includes(w.toLowerCase())) ? 1 : 0;
  };
  const uniq = links.filter((l) => l.url !== topUrl);
  const about = uniq.find((l) => score(l, ABOUT_WORDS) > 0)?.url ?? null;
  const contact = uniq.find((l) => score(l, CONTACT_WORDS) > 0)?.url ?? null;
  return { about, contact };
}

/**
 * サイトマップ（sitemap.xml）から「会社概要」「お問い合わせ」らしいURLを選ぶ。
 *
 * ★なぜ要るか。
 *   最近のHPは、メニューがプログラムで後から描かれることが多い。
 *   そうすると、トップページのHTMLの中にはリンクが数本しか入っておらず、
 *   「会社概要」へたどり着けない。会社概要が読めないと、住所も電話も代表者名も拾えず、
 *   結果として「社名は合っているが決め手が無い」で全部 不採用になってしまう。
 *   サイトマップは、そのサイト自身が「うちにはこのページがあります」と申告している一覧なので、
 *   ここから探すのが一番まっとうで、相手のサーバにも負担をかけない。
 */
export function pickSubPagesFromUrls(urls: string[], topUrl: string): { about: string | null; contact: string | null } {
  return pickSubPages(
    urls.map((u) => ({ url: u, label: '' })),
    topUrl,
  );
}

/** サイトマップを1つ読んで、中のURLを取り出す。索引形式なら1段だけたどる。 */
export async function urlsFromSitemap(sitemapUrl: string, depth = 0): Promise<string[]> {
  if (depth > 1) return [];
  try {
    const res = await fetch(sitemapUrl, {
      headers: { 'User-Agent': WEBSITE_UA, Accept: 'application/xml,text/xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const xml = (await res.text()).slice(0, MAX_BYTES);
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]));
    // 索引（sitemapindex）だったら、中の1本目だけをたどる。全部たどると相手に負担をかける。
    if (/<sitemapindex/i.test(xml)) {
      const first = locs.find((u) => sameOrganization(sitemapUrl, u));
      return first ? await urlsFromSitemap(first, depth + 1) : [];
    }
    return locs.filter((u) => /^https?:\/\//i.test(u) && sameOrganization(sitemapUrl, u)).slice(0, 2000);
  } catch {
    return [];
  }
}

/** そのサイトのサイトマップの場所を決める。robots.txt に書いてあればそれ、無ければ /sitemap.xml。 */
export async function sitemapUrlsFor(topUrl: string): Promise<string[]> {
  const rules = await loadRobots(topUrl);
  if (!rules.usable) return [];
  if (rules.sitemaps.length > 0) return rules.sitemaps.filter((u) => sameOrganization(topUrl, u)).slice(0, 2);
  try {
    return [new URL('/sitemap.xml', topUrl).toString()];
  } catch {
    return [];
  }
}

// ── 1ページを読む ─────────────────────────────────────────────

async function politeWait(url: string, delayMs: number): Promise<void> {
  const h = hostOf(url);
  if (!h) return;
  const last = lastHitAt.get(h);
  const now = Date.now();
  if (last !== undefined) {
    const wait = delayMs - (now - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  lastHitAt.set(h, Date.now());
}

const EMPTY_READ = (url: string, reason: string): PageRead => ({ ok: false, url, status: null, title: null, text: '', reason, links: [], html: '' });

/** 公開ページを1つだけ読む（GETのみ）。 */
export async function fetchPublicPage(url: string): Promise<PageRead> {
  if (!/^https?:\/\//i.test(url)) return EMPTY_READ(url, 'httpで始まるURLではない');
  if (!isOwnSiteUrl(url)) return EMPTY_READ(url, 'その会社が書いた文章ではない場所なので読まない');

  const rules = await loadRobots(url);
  if (!rules.usable) return EMPTY_READ(url, rules.reason);
  let path: string;
  try {
    const u = new URL(url);
    path = `${u.pathname}${u.search}`;
  } catch {
    return EMPTY_READ(url, 'URLの形になっていない');
  }
  if (!robotsAllowsPath(rules, path)) return EMPTY_READ(url, 'robots.txt で読まないよう指定されている場所');

  await politeWait(url, rules.crawlDelayMs);

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': WEBSITE_UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ...EMPTY_READ(url, `ページが${res.status}を返した`), status: res.status };
    const ctype = res.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml/i.test(ctype)) {
      return { ...EMPTY_READ(url, `HTMLではない（${ctype.split(';')[0] || '種類不明'}）`), status: res.status };
    }
    const html = (await res.text()).slice(0, MAX_BYTES);
    const finalUrl = res.url || url;
    // 転送先が別会社のドメインになっていたら、そこは読んだことにしない。
    if (!sameOrganization(url, finalUrl)) {
      return { ...EMPTY_READ(url, `別のドメイン（${hostOf(finalUrl)}）へ転送されたので読まない`), status: res.status };
    }
    return {
      ok: true,
      url: finalUrl,
      status: res.status,
      title: extractTitle(html),
      text: htmlToText(html).slice(0, 20_000),
      reason: '読めた',
      links: extractLinks(html, finalUrl),
      html: html.slice(0, 60_000),
    };
  } catch (e) {
    return EMPTY_READ(url, `つながらなかった（${(e as Error).message}）`);
  }
}

export type SiteRead = {
  ok: boolean;
  reason: string;
  /** 実際に読めたページ。 */
  pages: PageRead[];
  /** 3ページ分をつないだ文章。 */
  text: string;
  title: string | null;
  contactFormUrl: string | null;
};

/** トップ →（会社概要）→（お問い合わせ）の最大3ページを読む。 */
export async function readOfficialSite(topUrl: string): Promise<SiteRead> {
  const top = await fetchPublicPage(topUrl);
  if (!top.ok) return { ok: false, reason: top.reason, pages: [], text: '', title: null, contactFormUrl: null };

  const pages: PageRead[] = [top];
  let { about, contact } = pickSubPages(top.links, top.url);

  // トップページのHTMLからは見つからないことがある（メニューが後から描かれるHP）。
  // そのときだけ、サイト自身が公開しているサイトマップを見に行く。
  if (!about || !contact) {
    for (const sm of await sitemapUrlsFor(top.url)) {
      const urls = await urlsFromSitemap(sm);
      if (urls.length === 0) continue;
      const picked = pickSubPagesFromUrls(urls, top.url);
      about = about ?? picked.about;
      contact = contact ?? picked.contact;
      if (about && contact) break;
    }
  }

  for (const u of [about, contact]) {
    if (!u || pages.length >= MAX_PAGES_PER_COMPANY) continue;
    if (pages.some((p) => p.url === u)) continue;
    const p = await fetchPublicPage(u);
    if (p.ok) pages.push(p);
  }
  return {
    ok: true,
    reason: `${pages.length}ページ読めた`,
    pages,
    text: pages.map((p) => p.text).join('\n'),
    title: top.title,
    // 問い合わせページが読めたときだけ、フォームのURLとして採用する。
    contactFormUrl: contact && pages.some((p) => p.url === contact) ? contact : null,
  };
}

// ── ページから拾えるもの ────────────────────────────────────────

export function findPhone(text: string): string | null {
  const t = text.normalize('NFKC');
  const m = t.match(/0\d{1,4}[-(－ ]?\d{1,4}[-)－ ]?\d{3,4}/);
  return m ? m[0] : null;
}

export function findEmail(text: string): string | null {
  const m = text.normalize('NFKC').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m ? m[0] : null;
}
