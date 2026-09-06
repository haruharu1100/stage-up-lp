/**
 * 店舗ごとの法定・信頼ページ（会社情報／特商法／規約／プライバシー／FAQ／問い合わせ）。
 *
 * ═══════════════════════════════════════════════════════
 * ★中身を、このファイルに書かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   ここにあるのは「並べ方」だけです。
 *   会社名・住所・電話・規約の本文は、
 *   導入した店舗が管理画面で入れた値（tenant_settings）です。
 *
 *   ここに例文を書いて「未設定ならこれを出す」にすると、
 *   その日から、AI GACHA OS 運営会社の住所と電話が、
 *   よそのお店の特定商取引法の表記として世に出ます。
 *   1社に売るときは気づきません。5社に売った日に事故になります。
 *
 * ═══════════════════════════════════════════════════════
 * ★空欄を「準備中」と書いて隠さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   「準備中」は、読んだ方には親切に見えます。
 *   ですが、お店にとっては「まだ書いていない」ことが見えなくなります。
 *   見えないまま売り続けるほうが、はるかに危ないです。
 *
 *   ですので、はっきり「未設定」と出します。
 *   お店の人が自分の店を見たときに、気づける言葉にしてあります。
 *
 * ═══════════════════════════════════════════════════════
 * ★本文を HTML として描かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   規約とプライバシーポリシーは、お店が自由に打ち込む長文です。
 *   dangerouslySetInnerHTML で出すと、
 *   打ち込んだ文字がそのまま実行される穴になります。
 *   改行だけを活かす（whitespace-pre-wrap）で十分です。
 */

import type { PublicShopInfo } from "@/lib/server/publicShop";
import type { ShopDoc } from "@/lib/console/shopInfo";
import { SHOP_DOC_LABEL } from "@/lib/console/shopInfo";

/* ══════════════════════════════════════════════
   小さな部品
   ══════════════════════════════════════════════ */

/**
 * 1項目。
 *
 * ★未設定のときに、空白のまま何も出さないこと。
 *   項目ごと消えると、読んだ方は「そういう項目は無い」と受け取ります。
 *   項目名は残して、値のところに「未設定」と書きます。
 */
function Item({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-white/6 py-3 last:border-b-0 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-[0.76rem] font-bold text-white/45 sm:w-[9.5rem]">
        {k}
      </dt>
      <dd
        className={
          v === null
            ? "text-[0.84rem] font-bold leading-[1.8] text-[#FFB27A]"
            : "whitespace-pre-wrap break-words text-[0.84rem] leading-[1.9] text-white/85"
        }
      >
        {v === null ? "未設定" : v}
      </dd>
    </div>
  );
}

function Body({ text }: { text: string | null }) {
  if (text === null) {
    return (
      <p className="text-[0.84rem] font-bold leading-[1.9] text-[#FFB27A]">
        このお店では、まだ設定されていません。
      </p>
    );
  }
  return (
    <p className="whitespace-pre-wrap break-words text-[0.84rem] leading-[2] text-white/80">
      {text}
    </p>
  );
}

/* ══════════════════════════════════════════════
   本体
   ══════════════════════════════════════════════ */

export function StoreDocView({
  doc,
  shop,
}: {
  doc: ShopDoc;
  /** お店が決まらなかったときは null。★その場合、何も出しません */
  shop: PublicShopInfo | null;
}) {
  const title = SHOP_DOC_LABEL[doc];

  if (shop === null) {
    return (
      <>
        <h1 className="text-[1.15rem] font-bold text-white">{title}</h1>
        {/* ★ここで「1社目のお店」を出さないこと。
              よその会社の法人名・住所・電話が、
              このお店の表記として世に出ます。 */}
        <p className="mt-4 rounded-xl px-4 py-3 text-[0.84rem] leading-[1.9] text-[#FFB27A]"
           style={{ background: "rgba(255,150,90,0.08)", border: "1px solid rgba(255,150,90,0.25)" }}>
          お店の情報がまだ設定されていないため、この内容は表示できません。
        </p>
      </>
    );
  }

  const jusho =
    shop.address === null
      ? null
      : shop.postalCode === null
        ? shop.address
        : `〒${shop.postalCode}\n${shop.address}`;

  return (
    <>
      <h1 className="text-[1.15rem] font-bold text-white">{title}</h1>
      {shop.shopName !== null && (
        <p className="mt-1 text-[0.78rem] text-white/45">{shop.shopName}</p>
      )}

      <div className="mt-5">
        {doc === "company" && (
          <dl>
            <Item k="法人名・屋号" v={shop.legalName} />
            <Item k="ふりがな" v={shop.legalKana} />
            <Item k="代表者" v={shop.representative} />
            <Item k="所在地" v={jusho} />
            <Item k="電話番号" v={shop.phone} />
            <Item k="古物商許可番号" v={shop.antiqueLicense} />
            <Item k="メールでのご連絡先" v={shop.contactEmail} />
          </dl>
        )}

        {/* 特定商取引法に基づく表記。
            ★項目を減らさないこと。1つでも欠けていれば、
              このページは法律上の表示として成立していません。 */}
        {doc === "legal" && (
          <dl>
            <Item k="販売事業者" v={shop.legalName} />
            <Item k="運営統括責任者" v={shop.representative} />
            <Item k="所在地" v={jusho} />
            <Item k="電話番号" v={shop.phone} />
            <Item k="メールアドレス" v={shop.contactEmail} />
            <Item k="古物商許可番号" v={shop.antiqueLicense} />
            <Item k="販売価格" v={shop.priceNote} />
            <Item k="商品代金以外の必要料金" v={shop.extraFeeNote} />
            <Item k="お支払い方法" v={shop.paymentMethod} />
            <Item k="お支払い時期" v={shop.paymentTiming} />
            <Item k="商品の引渡時期" v={shop.deliveryTime} />
            <Item k="返品・キャンセル" v={shop.returnsNote} />
          </dl>
        )}

        {doc === "terms" && <Body text={shop.termsText} />}
        {doc === "privacy" && <Body text={shop.privacyText} />}

        {doc === "faq" &&
          (shop.faqs.length === 0 ? (
            <p className="text-[0.84rem] leading-[1.9] text-white/50">
              よくあるご質問は、まだ登録されていません。
            </p>
          ) : (
            <div className="space-y-4">
              {shop.faqs.map((f) => (
                <div key={f.id}>
                  <h2 className="text-[0.9rem] font-bold leading-[1.7] text-white">
                    Q. {f.question}
                  </h2>
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-[0.84rem] leading-[1.95] text-white/70">
                    {f.answer}
                  </p>
                </div>
              ))}
            </div>
          ))}

        {doc === "contact" && (
          <dl>
            <Item k="メールアドレス" v={shop.contactEmail} />
            <Item k="受付時間" v={shop.contactHours} />
            <Item k="ご案内" v={shop.contactNote} />
            <Item k="電話番号" v={shop.phone} />
          </dl>
        )}
      </div>
    </>
  );
}
