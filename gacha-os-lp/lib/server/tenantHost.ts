/**
 * 「いま開かれているサイトは、どのお店のものか」を、サーバー側だけで決める。
 *
 * ═══════════════════════════════════════════════════════
 * ★この道具ができる前は、お客様に会社コードを打たせていました
 * ═══════════════════════════════════════════════════════
 *
 *   会員登録の画面に「会社コード」という欄があり、
 *   お客様はそこに DEMO のような文字を打っていました。
 *
 *   ふつうのオンラインガチャのお店で、そんなものは聞かれません。
 *   聞かれた時点で、多くの方はそこで帰ります。
 *
 *   しかも、お客様はもう答えを持って来ています。
 *   「shop-a.example.com を開いた」ことが、そのまま答えです。
 *   聞く必要のないものを聞いていました。
 *
 * ═══════════════════════════════════════════════════════
 * ★決めるのは必ずサーバー。ブラウザに決めさせないこと
 * ═══════════════════════════════════════════════════════
 *
 *   ここから先、会社コードは本文（body）から一切受け取りません。
 *   受け取れる形が残っている限り、
 *   「本文の会社コードだけ書き換えて、よそのお店の入口を使う」
 *   ということができてしまいます。
 *
 *   ★入口（API）でも、この道具からだけ会社を決めてください。
 *     body.tenantCode を読む処理を、二度と足さないこと。
 *
 * ═══════════════════════════════════════════════════════
 * ★決まらないときは、はっきり断ること
 * ═══════════════════════════════════════════════════════
 *
 *   「決まらなかったので、とりあえず1社目」は絶対にやりません。
 *   よそのお店の会社名・住所・電話番号が、
 *   このお店の特定商取引法のページとして表示されます。
 *   お客様は、そのよその会社へ返品を求めます。
 *
 *   決まらないときは null を返します。呼んだ側が断ります。
 *
 * ═══════════════════════════════════════════════════════
 * ★探す順番（上から順に、最初に見つかったものを使う）
 * ═══════════════════════════════════════════════════════
 *
 *   ① tenant_domains の表     … 本番。お店ごとの独自ドメイン
 *   ② TENANT_HOST_MAP の設定  … 検証用・試験用の割り当て
 *   ③ DEFAULT_TENANT_CODE     … 1社だけを載せた配置／手元の開発
 *   ④ 見つからない            … null（＝断る）
 *
 *   ★①と②で決まったものだけを「その住所専用」とみなします。
 *     ③は「この配置にはこの1社しかいない」という意味なので、
 *     住所と結びついた指定ではありません。
 *     この違いは source で返します。混ぜないこと。
 */

import { headers } from "next/headers";
import { db, migrate } from "./db";
import { tenantByCode } from "./auth";

/** どうやって決まったか。混ぜると判断を誤るので、必ず分けて返します */
export type TenantHostSource = "DOMAIN" | "ENV_MAP" | "DEFAULT";

export type TenantHostResult = {
  tenantId: string;
  source: TenantHostSource;
  /** 実際に照合した住所（小文字・ポート込み） */
  host: string;
};

/**
 * 住所の書き方をそろえる。
 *
 * ★ポートを落とさないこと。
 *   手元の開発では localhost:3000 と localhost:3212 が別のお店です。
 *   ポートを落とすと、試験のときに隣の会社へ入ります。
 *
 * ★大文字小文字は区別しないこと（DNSの決まり）。
 * ★末尾の "." は同じ住所です（www.example.com. と www.example.com）。
 */
export function normalizeHost(raw: string | null | undefined): string {
  if (!raw) return "";
  let h = String(raw).trim().toLowerCase();
  /* 「a.example.com, b.example.com」のように積み重なることがあります。
     いちばん手前（最初）だけを見ます */
  const comma = h.indexOf(",");
  if (comma >= 0) h = h.slice(0, comma).trim();
  /* 末尾の "." を落とす（ポートがある場合は落とさない） */
  h = h.replace(/\.$/, "");
  return h;
}

/**
 * いまの通信の住所を取り出す。
 *
 * ★x-forwarded-host を先に見ること。
 *   Vercel などの配信の裏側では、host に内部の名前が入ることがあります。
 *   お客様が実際に打った住所は x-forwarded-host のほうです。
 */
export function hostFromHeaders(h: {
  get(name: string): string | null;
}): string {
  return normalizeHost(h.get("x-forwarded-host") ?? h.get("host"));
}

/** 画面（サーバーコンポーネント）から呼ぶとき用 */
export function currentHost(): string {
  try {
    return hostFromHeaders(headers());
  } catch {
    /* headers() が使えない場所（静的生成など）。決められません */
    return "";
  }
}

/**
 * 検証用・試験用の割り当てを読む。
 *
 *   TENANT_HOST_MAP="localhost:3212=DEMO,preview.example.com=SHOPA"
 *
 * ★本番のお店をここに書かないこと。
 *   環境変数は履歴が残らないので、
 *   「いつ・誰が・どのお店に割り当てたか」が追えません。
 *   本番は必ず tenant_domains の表に入れてください。
 */
function readEnvMap(env: NodeJS.ProcessEnv): Map<string, string> {
  const out = new Map<string, string>();
  const raw = env.TENANT_HOST_MAP;
  if (!raw || raw.trim() === "") return out;
  for (const part of raw.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const host = normalizeHost(part.slice(0, eq));
    const code = part.slice(eq + 1).trim();
    if (host === "" || code === "") continue;
    out.set(host, code);
  }
  return out;
}

/**
 * 住所から、お店を決める。
 *
 * @param host normalizeHost を通した住所
 * @returns 決まらなければ null（呼んだ側が断ってください）
 */
export async function resolveTenantByHost(
  host: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TenantHostResult | null> {
  const h = normalizeHost(host);

  /* ① お店ごとの独自ドメイン（本番の正本） */
  if (h !== "") {
    await migrate();
    const res = await db().execute({
      sql: `SELECT d.tenant_id AS tid, t.status AS st
              FROM tenant_domains d
              JOIN tenants t ON t.id = d.tenant_id
             WHERE d.host = ? LIMIT 1`,
      args: [h],
    });
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (row) {
      /* ★止まっているお店の住所で開かせないこと。
           解約済みのお店のページが、そのまま生き続けます */
      if (String(row.st) !== "ACTIVE") return null;
      return { tenantId: String(row.tid), source: "DOMAIN", host: h };
    }
  }

  /* ② 検証用・試験用の割り当て */
  if (h !== "") {
    const code = readEnvMap(env).get(h);
    if (code) {
      const t = await tenantByCode(code);
      if (!t || t.status !== "ACTIVE") return null;
      return { tenantId: t.id, source: "ENV_MAP", host: h };
    }
  }

  /* ③ 1社だけを載せた配置／手元の開発 */
  const def = env.DEFAULT_TENANT_CODE;
  if (def && def.trim() !== "") {
    const t = await tenantByCode(def.trim());
    if (!t || t.status !== "ACTIVE") return null;
    return { tenantId: t.id, source: "DEFAULT", host: h };
  }

  /* ④ 決まらない。★ここで1社目を拾わないこと */
  return null;
}

/** 画面（サーバーコンポーネント）から、いまのお店を決める */
export async function resolveTenantHere(): Promise<TenantHostResult | null> {
  return resolveTenantByHost(currentHost());
}

/**
 * ログインしている人と、いま開いている住所が食い違っていないか。
 *
 * ═══════════════════════════════════════════════
 * ★これが無いと、A店の会員証でB店に入れます
 * ═══════════════════════════════════════════════
 *
 *   合言葉（クッキー）は住所ごとに分かれますが、
 *   お店が同じ土台の別ドメインを使っている場合や、
 *   検証環境で住所を差し替えた場合に、
 *   「A店でログインした状態のまま、B店のページを開く」
 *   ということが起こり得ます。
 *
 *   そのとき、画面はB店の看板を出しながら、
 *   中身はA店の残高・A店の獲得商品を出します。
 *   お客様には、何が起きているのか分かりません。
 *
 *   ★食い違ったら、ログインしていない扱いにします。
 *
 * @returns true = そのまま進んでよい
 */
export async function hostMatchesTenant(
  sessionTenantId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  return hostMatchesTenantFor(currentHost(), sessionTenantId, env);
}

/**
 * 上と同じ判断を、住所を自分で渡して行う。
 *
 * ★入口（API）からは、必ずこちらを使うこと。
 *   入口では headers() ではなく req.headers が正本です。
 *   判断のもとは1か所（この関数）だけにしてあります。
 */
export async function hostMatchesTenantFor(
  host: string,
  sessionTenantId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const here = await resolveTenantByHost(host, env);
  /* 住所からお店が決まらない配置（社内の管理用の入口など）では、
     ここでは判断しません。判断できないものを不合格にすると、
     正しく入っている人まで締め出します */
  if (!here) return true;
  return here.tenantId === sessionTenantId;
}
