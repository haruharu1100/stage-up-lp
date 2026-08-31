/**
 * 問い合わせフォームを送ってよいかを判断する。
 *
 * ★これまで「相手の同意が要らないので一番安全」と書いていた。これは間違い。
 *   ・問い合わせフォームは「問い合わせのため」に置かれている。営業のためではない。
 *   ・「営業目的の送信はお断りします」と書いてあるフォームは非常に多い。
 *   ・利用規約で営業行為を禁じているサイトもある。
 *   ・送った内容は相手の担当者へそのまま届く。電話より軽い、ということはない。
 *   だから「同意が要らない」を理由に安全とは言わない。その考え方ごと捨てる。
 *
 * ★判定は3つだけ。「たぶん大丈夫」は作らない。
 *   ALLOWED            … フォーム自身が営業・提案の受付を明記している
 *   BLOCKED            … 営業お断り・営業禁止が読み取れる
 *   APPROVAL_REQUIRED  … それ以外すべて（＝分からない）。人が見て決める。
 *
 * ★CAPTCHA や認証があるフォームは自動化しない。回避もしない。
 *   自動で送れないことは不具合ではなく、そういう決まりだと扱う。
 */

export const FORM_POLICIES = ['ALLOWED', 'BLOCKED', 'APPROVAL_REQUIRED'] as const;
export type FormPolicy = (typeof FORM_POLICIES)[number];

export const FORM_POLICY_JA: Record<FormPolicy, string> = {
  ALLOWED: '営業の受付が明記されている',
  BLOCKED: '営業お断りなので送らない',
  APPROVAL_REQUIRED: '分からないので人が見て決める',
};

/** 営業を断っている書き方。1つでも見つかれば送らない。 */
const DENY_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /営業(目的|活動|行為)?の?(お|ご)?(問い?合わせ|連絡|メール|送信)?は?(ご)?(遠慮|お断り|禁止|受け付けて?(おりません|いません))/, label: '営業目的の送信を断っている' },
  { re: /(営業|セールス|勧誘|売り込み)(の|に関する)?(お|ご)?(電話|メール|連絡|案内|提案)?は?(固く)?(お断り|ご遠慮|禁止)/, label: '営業・勧誘を断っている' },
  { re: /営業(の)?(お|ご)?断り/, label: '営業お断りの表記' },
  { re: /(商品|サービス|システム)の?(売り込み|セールス|営業|紹介)(目的)?(で)?の?(ご)?(利用|送信|投稿)は?(お断り|ご遠慮|禁止|不可)/, label: '売り込み目的の利用を禁止している' },
  { re: /(当|本)(フォーム|窓口)は?[^。]{0,30}(営業|勧誘|セールス)[^。]{0,20}(利用|目的)[^。]{0,10}(できません|不可|禁止|お断り)/, label: 'フォームの用途として営業を除外している' },
  { re: /no\s+solicitation|solicitations?\s+(are\s+)?not\s+(accepted|welcome)/i, label: '営業を受け付けないと英語で書いてある' },
];

/** 営業・提案の受付をはっきり書いている書き方。ここに当たったときだけ ALLOWED。 */
const ALLOW_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /(お取引|取引|協業|業務提携|パートナー)(の)?(ご)?(相談|提案|お問い?合わせ|希望)/, label: '取引・提携の相談を受け付けている' },
  { re: /(ご提案|営業)(の)?(お)?(問い?合わせ|方|窓口)は?こちら/, label: '提案・営業の窓口が用意されている' },
  { re: /(仕入|購買|調達)(の)?(ご)?(提案|お問い?合わせ|窓口)/, label: '購買・調達の窓口がある' },
  { re: /(協力会社|取引先)(の)?(募集|登録|ご応募)/, label: '協力会社・取引先を募集している' },
];

/** フォームに認証・CAPTCHAがあるか。あれば自動化しない（回避もしない）。 */
const HUMAN_ONLY_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /recaptcha|g-recaptcha|hcaptcha|turnstile/i, label: '自動送信よけ（CAPTCHA）がある' },
  { re: /画像認証|認証コード|ロボットではありません/, label: '画像認証・本人確認がある' },
  { re: /ログイン(が|して)?(必要|してください)|会員登録が必要/, label: 'ログインが必要' },
];

export type FormPolicyResult = {
  policy: FormPolicy;
  reason: string;
  /** 判断のもとにした文言。人が読んで確かめられるように残す。 */
  matched: string[];
  /** 人しか送れない形か（CAPTCHA・ログイン）。 */
  humanOnly: boolean;
};

/**
 * フォームのページ・利用規約・フォームの説明文をまとめて見て判断する。
 *
 * ★何も読めなかったときに ALLOWED を返さない。必ず APPROVAL_REQUIRED になる。
 * ★禁止と受付の両方が見つかったら、禁止を優先する。
 */
export function judgeFormPolicy(input: {
  /** フォームのページ本文 */
  formPageText?: string | null;
  /** 利用規約の本文 */
  termsText?: string | null;
  /** フォームの近くにある説明文 */
  formNoteText?: string | null;
  /** フォームのHTML（CAPTCHAの有無を見る） */
  formHtml?: string | null;
}): FormPolicyResult {
  const text = [input.formPageText, input.termsText, input.formNoteText]
    .filter(Boolean)
    .join('\n')
    .normalize('NFKC');
  const html = String(input.formHtml ?? '');

  const humanOnlyHits = HUMAN_ONLY_PATTERNS.filter((p) => p.re.test(html) || p.re.test(text));
  const humanOnly = humanOnlyHits.length > 0;

  if (text.replace(/\s/g, '').length < 20) {
    return {
      policy: 'APPROVAL_REQUIRED',
      reason: 'フォームの説明も利用規約も読めなかった。分からないので人が見て決める。',
      matched: [],
      humanOnly,
    };
  }

  const denies = DENY_PATTERNS.filter((p) => p.re.test(text));
  if (denies.length > 0) {
    return {
      policy: 'BLOCKED',
      reason: `営業目的の送信を断っている：${denies[0].label}`,
      matched: denies.map((d) => d.label),
      humanOnly,
    };
  }

  const allows = ALLOW_PATTERNS.filter((p) => p.re.test(text));
  if (allows.length > 0) {
    // ★受付が明記されていても、CAPTCHAやログインがあれば自動では送らない。
    //   回避はしない。人が承認画面から開いて自分で送る。
    if (humanOnly) {
      return {
        policy: 'APPROVAL_REQUIRED',
        reason: `営業の受付はあるが、${humanOnlyHits[0].label}ので自動では送らない。人が開いて自分で送る。`,
        matched: allows.map((a) => a.label).concat(humanOnlyHits.map((h) => h.label)),
        humanOnly,
      };
    }
    return {
      policy: 'ALLOWED',
      reason: `営業・提案の受付が書かれている：${allows[0].label}`,
      matched: allows.map((a) => a.label),
      humanOnly,
    };
  }

  return {
    policy: 'APPROVAL_REQUIRED',
    reason: '営業してよいとも、してはいけないとも書かれていない。分からないので人が見て決める。',
    matched: humanOnlyHits.map((h) => h.label),
    humanOnly,
  };
}

/** フォーム送信の自動実行を許してよいか。★ALLOWED 以外はすべて不可。 */
export function formAutoAllowed(policy: FormPolicy | null | undefined): boolean {
  return policy === 'ALLOWED';
}
