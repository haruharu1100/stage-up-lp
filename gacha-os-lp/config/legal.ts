/**
 * 事業者情報と法務ページの設定。
 *
 * ★重要
 * ここは「実際に確認できる事実」だけを入れてください。
 * 空のまま公開すると、個人情報の取り扱いページに事業者名が出ません。
 * 公開前チェック（/launch）で自動的に警告されます。
 *
 * 環境変数でも上書きできます（Vercel の Environment Variables）。
 *   NEXT_PUBLIC_OPERATOR_NAME    事業者名
 *   NEXT_PUBLIC_OPERATOR_CONTACT 問い合わせ窓口（メールアドレス）
 */

const pick = (envValue: string | undefined, fallback: string) => {
  const v = envValue?.trim();
  return v ? v : fallback;
};

export const operator = {
  /** 事業者名（法人名または屋号） */
  name: pick(process.env.NEXT_PUBLIC_OPERATOR_NAME, ""),
  /** 個人情報の問い合わせ窓口 */
  contact: pick(process.env.NEXT_PUBLIC_OPERATOR_CONTACT, ""),
};

export const operatorReady = Boolean(operator.name && operator.contact);

/** 表示用。未設定なら、はっきり「未設定」と出す（それらしい嘘を書かない） */
export const operatorName = operator.name || "（事業者名 未設定）";
export const operatorContact = operator.contact || "（問い合わせ窓口 未設定）";

/**
 * このサイトで実際に取得している情報。
 * 実装（app/api/contact/route.ts・lib/lead.ts・components/Analytics.tsx）と
 * 一致させてください。書いてあるのに取っていない／取っているのに書いていない、を作らない。
 */
export const collectedData = [
  {
    what: "ご相談フォームに入力された内容",
    detail:
      "会社名・屋号、お名前、メールアドレス、運営状況、ご希望、補足欄の内容。お名前とメールアドレスのみ必須です。",
    why: "ご相談への回答と、その後のご連絡のため。",
  },
  {
    what: "流入元の記録",
    detail:
      "どのURLから来られたか（営業担当コード、広告のパラメータ、直前の参照元）。個人を特定する情報は含みません。",
    why: "どの案内が役に立ったかを把握するため。ブラウザのタブを閉じると消えます（Cookie は使いません）。",
  },
  {
    what: "アクセス解析",
    detail:
      "Google Analytics 4 および Microsoft Clarity を設定している場合のみ、閲覧されたページや操作の記録を各社が取得します。設定していない場合は、これらのタグを読み込みません。",
    why: "どこで分かりにくくなっているかを把握し、サイトを改善するため。",
  },
] as const;

export const legalPolicy = [
  {
    h: "利用目的",
    b: "お預かりした情報は、ご相談への回答、お見積りのご提示、導入に関するご連絡にのみ使用します。ご本人の同意なく、これ以外の目的には使用しません。",
  },
  {
    h: "第三者への提供",
    b: "法令に基づく場合を除き、ご本人の同意なく第三者へ提供することはありません。営業目的でのリスト提供・販売は行いません。",
  },
  {
    h: "外部サービスの利用",
    b: "お問い合わせ内容の受け取り、アクセス解析のために外部サービスを利用します。各サービスにおける取り扱いは、それぞれの提供事業者の定めによります。",
  },
  {
    h: "安全管理",
    b: "通信は暗号化（HTTPS）しています。受け取った内容は、担当者が業務上必要な範囲でのみ取り扱います。",
  },
  {
    h: "保管期間",
    b: "ご相談の対応およびその後のご連絡に必要な期間、保管します。不要になった時点で削除します。",
  },
  {
    h: "開示・訂正・削除のご請求",
    b: "ご自身の情報について、開示・訂正・利用停止・削除をご希望の場合は、下記の窓口までご連絡ください。ご本人であることを確認のうえ、速やかに対応します。",
  },
  {
    h: "Cookie について",
    b: "このサイトは、当社の目的で Cookie を発行していません。流入元の記録は、ブラウザを閉じると消える一時的な保存領域（sessionStorage）のみを使用しています。アクセス解析を設定している場合は、各サービスが Cookie 等を使用することがあります。",
  },
] as const;
