/**
 * お客様側（ログインしていない人も含む）に見せる、お店の情報。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、ログインしていない人にも見せるのか
 * ═══════════════════════════════════════════════════════
 *
 *   特定商取引法に基づく表記・利用規約・プライバシーポリシーは、
 *   「買う前の人」が読むためのものです。
 *   ログインしないと読めない場所に置くのは、置いていないのと同じです。
 *
 *   ですので、この道具はログインを求めません。
 *   代わりに、返す中身を、もともと公開する項目だけに絞ります。
 *
 * ═══════════════════════════════════════════════════════
 * ★返してよい項目を、ここで1回だけ決めます
 * ═══════════════════════════════════════════════════════
 *
 *   tenant_settings には、これから
 *   決済の設定など、外に出してはいけない項目が増えていきます。
 *   「全部返して、画面側で選ぶ」にすると、増やした日に漏れます。
 *
 *   ですので、ここは「出す項目を並べる」形にしてあります。
 *   ★新しい項目を足したくなったら、ここに1行足してください。
 *     ここに無いものは、絶対に外へ出ません。
 *
 * ═══════════════════════════════════════════════════════
 * ★どの会社かが決まらないときは、1社目を使わないこと
 * ═══════════════════════════════════════════════════════
 *
 *   「決まらなかったので、とりあえず最初の会社」にすると、
 *   よその会社の法人名・住所・電話番号が、
 *   このお店の特商法ページとして表示されます。
 *   決まらないときは、null を返して、画面には何も出しません。
 */

import { db } from "./db";
import { tenantByCode } from "./auth";

type Row = Record<string, unknown>;

function nul(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** お客様に見せてよい、お店の情報 */
export type PublicShopInfo = {
  tenantId: string;
  shopName: string | null;
  logoImageId: string | null;
  brandColor: string | null;

  /* 特定商取引法に基づく表記 */
  legalName: string | null;
  legalKana: string | null;
  representative: string | null;
  postalCode: string | null;
  address: string | null;
  phone: string | null;
  antiqueLicense: string | null;
  priceNote: string | null;
  extraFeeNote: string | null;
  paymentMethod: string | null;
  paymentTiming: string | null;
  deliveryTime: string | null;
  returnsNote: string | null;

  /* 問い合わせ */
  contactEmail: string | null;
  contactHours: string | null;
  contactNote: string | null;

  /* 長い本文 */
  termsText: string | null;
  privacyText: string | null;

  faqs: { id: string; question: string; answer: string }[];

  /**
   * 法定ページが空のままかどうか。
   *
   * ★これを「準備中」と書いて隠さないこと。
   *   隠すと、お店は自分の設定が空であることに気づけません。
   *   気づかないまま売り続けるほうが、はるかに危ないです。
   */
  legalReady: boolean;
};

/**
 * いま見ているお客様の「お店」を決める。
 *
 * @param sessionTenantId ログインしている人のセッションにある会社ID。
 *   ログインしていなければ null を渡してください。
 */
export async function resolvePublicTenantId(
  sessionTenantId: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  if (sessionTenantId !== null && sessionTenantId.trim() !== "") {
    return sessionTenantId;
  }
  /* ログインしていない人。1つのお店＝1つの配置なので、
     設定してある会社コードから決めます。
     ★決まらなければ null。ここで「1社目」を拾わないこと。 */
  const code = env.DEFAULT_TENANT_CODE;
  if (!code || code.trim() === "") return null;

  const tenant = await tenantByCode(code.trim());
  if (!tenant || tenant.status !== "ACTIVE") return null;
  return tenant.id;
}

export async function getPublicShopInfo(
  tenantId: string,
): Promise<PublicShopInfo> {
  const res = await db().execute({
    sql: `SELECT shop_name, logo_image_id, brand_color,
                 legal_name, legal_kana, representative,
                 postal_code, address, phone, antique_license,
                 price_note, extra_fee_note, payment_method, payment_timing,
                 delivery_time, returns_note,
                 contact_email, contact_hours, contact_note,
                 terms_text, privacy_text
            FROM tenant_settings WHERE tenant_id = ?`,
    args: [tenantId],
  });
  const r = (res.rows[0] as Row | undefined) ?? {};

  const faqRes = await db().execute({
    sql: `SELECT id, question, answer FROM tenant_faqs
           WHERE tenant_id = ? ORDER BY sort_order ASC, updated_at ASC`,
    args: [tenantId],
  });

  const info: PublicShopInfo = {
    tenantId,
    shopName: nul(r.shop_name),
    logoImageId: nul(r.logo_image_id),
    brandColor: nul(r.brand_color),

    legalName: nul(r.legal_name),
    legalKana: nul(r.legal_kana),
    representative: nul(r.representative),
    postalCode: nul(r.postal_code),
    address: nul(r.address),
    phone: nul(r.phone),
    antiqueLicense: nul(r.antique_license),
    priceNote: nul(r.price_note),
    extraFeeNote: nul(r.extra_fee_note),
    paymentMethod: nul(r.payment_method),
    paymentTiming: nul(r.payment_timing),
    deliveryTime: nul(r.delivery_time),
    returnsNote: nul(r.returns_note),

    contactEmail: nul(r.contact_email),
    contactHours: nul(r.contact_hours),
    contactNote: nul(r.contact_note),

    termsText: nul(r.terms_text),
    privacyText: nul(r.privacy_text),

    faqs: (faqRes.rows as unknown as Row[]).map((f) => ({
      id: String(f.id),
      question: String(f.question),
      answer: String(f.answer),
    })),

    legalReady: false,
  };

  /* 「読める法定ページになっているか」の判定。
     ★ここをゆるめないこと。1項目でも欠けていれば、
       そのページは法律上の表示として成立していません。 */
  info.legalReady =
    info.legalName !== null &&
    info.representative !== null &&
    info.postalCode !== null &&
    info.address !== null &&
    info.phone !== null &&
    info.priceNote !== null &&
    info.extraFeeNote !== null &&
    info.paymentMethod !== null &&
    info.paymentTiming !== null &&
    info.deliveryTime !== null &&
    info.returnsNote !== null &&
    info.termsText !== null &&
    info.privacyText !== null &&
    info.contactEmail !== null;

  return info;
}
