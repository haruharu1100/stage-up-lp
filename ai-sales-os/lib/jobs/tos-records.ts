import type { ReadPolicy, AutoApplyPolicy, PermissionEvidence } from './sites';

/**
 * 求人サイトの規約を人が確認した結果を、台帳へ記録する。
 *
 * ★このファイルに書いてあるのは「2026-08-29に公式ページを実際に開いて読んだ結果」。
 *   推測で書き足さないこと。書き足したいときは、必ず公式ページを開き直して
 *   原文の引用（quote）とURLと確認日を一緒に入れること。
 *
 * ★恒久ルール（他のAIも必ず従うこと）
 *   「AIを使ってよい」 ≠ 「外部のプログラムが自動で応募してよい」
 *   5サイトすべてを実際に読んだ結果、外部プログラムによる自動応募を
 *   明確に許可した記述は 1件も無かった。よって全サイト APPROVAL_REQUIRED。
 *   AUTO_ALLOWED は 0件。
 *
 * ★もう一つの発見（応募より手前の問題）
 *   ランサーズ・シュフティ・クラウディアは、ほぼ同じ文言で
 *   「営業目的での二次利用・複製」を禁じている。案件情報を自動で集めて
 *   自社システムに取り込む行為そのものが、この条項に当たる可能性がある。
 *   クラウドワークスは robots.txt で ClaudeBot / GPTBot を全面拒否している。
 *   → 案件の取り込みは「人が見て手で入れる（CSV）」だけにする。
 *     自動収集する処理は作らない。
 */

export type TosRecord = {
  code: string;
  readPolicy: ReadPolicy;
  applicationMode: AutoApplyPolicy;
  permissionEvidence: PermissionEvidence;
  hasOfficialApi: 'YES' | 'NO' | 'UNKNOWN';
  officialAutomationAvailable: 'YES' | 'NO' | 'UNKNOWN';
  automationStatus: string;
  evidenceQuote: string;
  evidenceUrl: string;
  policyUrl: string;
  guidelineUrl?: string | null;
  robotsSummary: string;
  reason: string;
  note: string;
};

/** この台帳を人が実際に読んだ日。 */
export const TOS_CHECKED_AT = '2026-08-29';

export const TOS_RECORDS: TosRecord[] = [
  {
    code: 'LANCERS',
    readPolicy: 'MANUAL_ONLY',
    applicationMode: 'APPROVAL_REQUIRED',
    permissionEvidence: 'NONE',
    hasOfficialApi: 'NO',
    officialAutomationAvailable: 'YES',
    automationStatus:
      '規約本文に「ロボット」「クローラ」「スクレイピング」「API」の語は一度も出てこない。'
      + 'ただし第31条の二次利用禁止により、案件情報を営業目的で自社システムへ取り込む行為は抵触の恐れがある。',
    evidenceQuote:
      '【第31条 禁止事項】本サイト又は本サイトの一部（コンテンツ・情報・機能・システム・プログラム等）を使用・転用・転売・複製・送信・翻訳・翻案などして、いかなる手法であるかにかかわらず、商業・営業目的の活動、営利を目的とした利用及びその準備を目的とした利用をすること、その他本サイトの二次利用や複製行為。'
      + '\n【第8条】会員が本サイト内で登録・掲載した仕事・提案（自動提案機能を利用して登録されたものを含みます。）に関する一切の責任は、当該会員が負うものとします。',
    evidenceUrl: 'https://www.lancers.jp/help/terms',
    policyUrl: 'https://www.lancers.jp/help/terms',
    guidelineUrl: 'https://info.lancers.jp/34568',
    robotsSummary:
      'ClaudeBot は Crawl-delay: 5（拒否ではない）。ia_archiver と archive.org_bot は Disallow: /。'
      + '一般クローラは一部の検索絞り込みURLのみ Disallow。',
    reason:
      '外部プログラムによる自動応募を明確に許可した記述が、規約にもヘルプにも存在しない。'
      + '規約にある「自動提案機能」はランサーズ公式が提供する機能で、2026-03-18に「提案アシスト」へ改称された（公式アナウンス info.lancers.jp/34568）。'
      + 'これを外部プログラムの許可根拠には絶対に使わない。よって応募の確定は人が1クリックする。',
    note: '案件の取り込みは人が手で入れる（自動収集はしない）。第31条の二次利用禁止に当たる恐れがあるため。',
  },
  {
    code: 'CROWDWORKS',
    readPolicy: 'PROHIBITED',
    applicationMode: 'APPROVAL_REQUIRED',
    permissionEvidence: 'NONE',
    hasOfficialApi: 'NO',
    officialAutomationAvailable: 'NO',
    automationStatus:
      '規約に自動化を名指しする条項は無いが、robots.txt が AI系クローラを全面拒否し /api/ も遮断しており、'
      + '自動アクセスを断る意思がはっきりしている。第23条(15)により営利目的での利用には事前の書面承認が必要と読める。',
    evidenceQuote:
      '【第23条 禁止事項 (15)】弊社が事前に書面をもって承認した場合を除く、本サービスに基づく業務委託以外を目的とした本サービスを使用した営業活動、本サービスに基づく業務委託以外の営利活動を目的とした本サービスの利用にかかる行為、又はその準備を目的とした本サービスの利用にかかる行為。'
      + '\n【第23条 禁止事項 (12)】他者の設備若しくは本サービス用設備に無権限でアクセスし、又はポートスキャン、DOS攻撃若しくは大量のメール送信等により、その利用若しくは運営に支障を与える行為、又は支障を与えるおそれのある行為。',
    evidenceUrl: 'https://crowdworks.jp/pages/agreement',
    policyUrl: 'https://crowdworks.jp/pages/agreement',
    guidelineUrl: null,
    robotsSummary:
      '★ClaudeBot / GPTBot / meta-externalagent / Baiduspider系 はいずれも Disallow: /（全面拒否）。'
      + '全クローラに対して /api/ /admin/ /internal/ 等を Disallow。bingbot は Crawl-delay: 10。',
    reason:
      '外部プログラムによる自動応募を許可する記述は皆無。それどころか robots.txt が ClaudeBot / GPTBot を全面拒否しており、'
      + '自動アクセス自体を断っている。「AIを仕事に使うこと自体は禁止されていない」ことは、外部プログラム応募の許可根拠には一切ならない。',
    note: '★robots.txt で全面拒否されているため、案件の自動収集は行わない。人が見て手で入れる分だけを扱う。',
  },
  {
    code: 'COCONALA',
    readPolicy: 'MANUAL_ONLY',
    applicationMode: 'APPROVAL_REQUIRED',
    permissionEvidence: 'NONE',
    hasOfficialApi: 'NO',
    officialAutomationAvailable: 'NO',
    automationStatus:
      '★5サイトで唯一、自動応答ソフトの利用を名指しで禁止する条項がある（第13条第2項(22)）。'
      + '自動で返事をする作りにすると PROHIBITED へ動かすこと。robots.txt も提案・受注系のURLを軒並み拒否している。',
    evidenceQuote:
      '【第13条第2項(22)】出品者より提供されたサービス・コンテンツ等に対し、自動的に応答する等の機能を有する装置、ソフトウェア、アルゴリズム等を利用する行為。'
      + '\n【第13条第2項(29)】当社サービスの運営及び当社の業務を妨害する行為。',
    evidenceUrl: 'https://coconala.com/pages/terms_user',
    policyUrl: 'https://coconala.com/pages/terms_user',
    guidelineUrl: null,
    robotsSummary:
      '/offers /direct_offers /orders /talkrooms /message /mypage など、提案・受注・やりとり系のURLを明示的に Disallow。',
    reason:
      '第13条第2項(22)が「自動的に応答する等の機能を有する装置、ソフトウェア、アルゴリズム等」の利用を明確に禁じている。'
      + '外部プログラムが自動で応答・応募する動きは、この条項に当たる可能性が高い。許可の記述は無いので、人の承認を必須とする。',
    note: '所得・副業系の出品は景表法・規約リスクで別途不可（既存の判断を維持）。自動応答の作りにしないこと。',
  },
  {
    code: 'SHUFTI',
    readPolicy: 'MANUAL_ONLY',
    applicationMode: 'APPROVAL_REQUIRED',
    permissionEvidence: 'NONE',
    hasOfficialApi: 'NO',
    officialAutomationAvailable: 'NO',
    automationStatus:
      '規約に「ロボット」「クローラ」「スクレイピング」「API」の語は一度も出てこない。'
      + 'ただし第18条の二次利用禁止・複写利用禁止が、案件情報の取り込みに当たる恐れがある。robots.txt は存在しない（404）。',
    evidenceQuote:
      '【第18条第1項】シュフティ若しくはシュフティの一部（コンテンツ・情報・機能・システム・プログラム等）を使用・転用・転売・複製・送信・翻訳・翻案などして、手法の如何を問わず商業・営業目的の活動、営利を目的とした利用又はその準備を目的とした利用をすること、その他シュフティの2次利用行為又は複製行為。'
      + '\n【第18条第1項】シュフティを翻訳・転載・引用・複写・コピーなどをして利用する行為。',
    evidenceUrl: 'https://help.shufti.jp/support/solutions/articles/158000411011',
    policyUrl: 'https://help.shufti.jp/support/solutions/articles/158000411011',
    guidelineUrl: null,
    robotsSummary:
      'robots.txt は存在しない（app.shufti.jp/robots.txt は HTTP 404 を確認）。'
      + '許可も拒否も表明されていない。表明が無いことは許可ではない。',
    reason:
      '外部プログラムによる自動応募を許可する記述が無く、逆に第18条が営業目的の二次利用・複写利用を広く禁じている。'
      + 'robots.txt も無いため、自動アクセスの許諾はどこからも導けない。',
    note: '案件の取り込みは人が手で入れる。',
  },
  {
    code: 'CRAUDIA',
    readPolicy: 'MANUAL_ONLY',
    applicationMode: 'APPROVAL_REQUIRED',
    permissionEvidence: 'NONE',
    hasOfficialApi: 'NO',
    officialAutomationAvailable: 'NO',
    automationStatus:
      '規約に「自動」「ロボット」「クローラ」「スクレイピング」「API」の語は一度も出てこない。'
      + 'robots.txt の一般クローラ制限は緩いが、第22条(13)の二次利用禁止が営業目的の取り込みを広く禁じている。',
    evidenceQuote:
      '【第22条第1項(13)】本件サイト若しくは本件サイトの一部（コンテンツ・情報・機能・システム・プログラム等）を使用・転用・転売・複製・送信・翻訳・翻案などして、いかなる手法を問わず商業・営業目的の活動、営利を目的とした利用及びその準備を目的とした利用をすること、その他本件サイトの2次利用や複製行為。'
      + '\n【第22条第1項(17)】不当な目的のために本件サイトを翻訳・転載・引用・複写・コピーなどをして利用する行為。',
    evidenceUrl: 'https://www.craudia.com/app/agreement',
    policyUrl: 'https://www.craudia.com/app/agreement',
    guidelineUrl: 'https://www.craudia.com/project_guideline',
    robotsSummary:
      '一般クローラは /upload/ のみ Disallow と緩い。DataForSeoBot / SemrushBot / Bytespider 等は Disallow: /。'
      + 'ClaudeBot・GPTBot への言及は無い。',
    reason:
      '外部プログラムによる自動応募を許可する記述が存在しない。robots.txt の制限は緩いが、'
      + '第22条(13)が営利目的の二次利用を明確に禁じているため、人の承認を必須とする。',
    note: '案件の取り込みは人が手で入れる。',
  },
  {
    code: 'MANUAL',
    readPolicy: 'MANUAL_ONLY',
    applicationMode: 'APPROVAL_REQUIRED',
    permissionEvidence: 'NONE',
    hasOfficialApi: 'NO',
    officialAutomationAvailable: 'NO',
    automationStatus: 'サイトを経由しない案件（紹介・直接依頼）。プラットフォームの規約は関係しないが、応募の確定は人が行う。',
    evidenceQuote:
      '【このシステムの運用ルール】サイトを経由しない案件は、規約による判断ができない。'
      + '判断できないものを自動で送らないという原則に従い、必ず人が内容を読んで1クリックで確定する。',
    evidenceUrl: 'https://www.lancers.jp/help/terms',
    policyUrl: 'https://www.lancers.jp/help/terms',
    guidelineUrl: null,
    robotsSummary: '該当なし（サイトを経由しないため）。',
    reason: '規約で判断できる相手ではないので、内容の良し悪しを人が読んで決める。自動では送らない。',
    note: '紹介・直接依頼。引用元URLは形式を満たすためランサーズ規約を置いているが、判断の根拠は運用ルールそのもの。',
  },
];
