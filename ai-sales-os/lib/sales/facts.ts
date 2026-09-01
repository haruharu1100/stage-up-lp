import { all, type Row } from '../db/client';
import { normalizeText, pickVariant as variant, similarity } from '../text';

/**
 * 営業文に書く「その会社の事実」を選ぶ。
 *
 * ★ここが営業文の質の中心。
 *   会社の紹介文には、どの会社にも書いてある決まり文句（「地元で30年以上」「創業してまだ3年」など）と、
 *   その会社にしか書いていない一文（「内見予約の電話対応に人手を取られている」など）が混ざっている。
 *   決まり文句を引用しても「あなたの会社を読みました」にはならない。読んだふりの文面になる。
 *
 * ★なので、同じ一文を何社が書いているかを先に数え、1社しか書いていない一文を優先して使う。
 *   数えていない状態（未計測）のときは、今までどおり全部を候補にする。数え損ねを理由に文面が消えるほうが困る。
 *
 * ★事実は必ず会社の記録そのものから取る。AIが想像で足した一文は使わない。
 *   後段の「事実に基づいているか」の採点で、記録に無い文が混ざっていないかを機械で確かめる。
 */

/**
 * HPの「メニュー欄」を並べただけの断片かどうか。
 *
 * ★HP本文には、本文と一緒にメニュー（ホーム／会社概要／お問い合わせ…）が混ざって入る。
 *   それを一文と勘違いして引用すると、電話でこう読み上げることになる:
 *     「『総合建設業の花田工業株式会社｜大阪府｜和泉市GREETINGごあいさつBUSINESS事業COMPANY会社概要CONT』
 *       という記載を拝見してお電話しています」
 *   これは日本語として意味を成さず、相手には「機械が適当に喋っている」としか聞こえない。
 *   実際に上位10社のうち2社でこの文面ができていた。
 */
const NAV_WORDS = [
  'ホーム', '会社概要', '会社案内', '会社情報', '企業情報', '事業内容', 'お問い合わせ', 'お問合せ',
  '採用情報', '求人案内', '求人募集', '新着情報', 'サービス内容', 'アクセス', 'プライバシー',
  'サイトマップ', '個人情報', 'トップページ', 'ごあいさつ', '代表挨拶',
];

/**
 * HPの見出しに使われる英語のラベル。
 *
 * ★実データで見つかった壊れ方：
 *     「CONTACTFORMCONTACTFORMお電話でのお問い合わせは下記電話番号よりご連絡ください」
 *   これを引用すると、相手には「機械が拾ったゴミをそのまま送ってきた」と読まれる。
 *   これまでの判定は「大文字の塊が2つ以上」で見ていたため、
 *   CONTACTFORMCONTACTFORM のように塊が1つに繋がっている形を素通りさせていた。
 */
const HEADING_LABELS =
  /(CONTACT|COMPANY|GREETING|BUSINESS|RECRUIT|SERVICE|PRODUCT|ACCESS|PRIVACY|POLICY|MESSAGE|PHILOSOPHY|TOPICS|WORKS|ABOUT|OUTLINE|CONCEPT|GALLERY|MENU|HOME|NEWS|STAFF|BLOG|SHOP|VOICE|FLOW|PRICE|ENTRY|MISSION|VISION|HISTORY|FACILITY|EQUIPMENT|QUALITY|SUPPORT|DOWNLOAD|SITEMAP|GUIDE|EVENT|MEDIA|BRAND|STORY|CAREER|SEARCH|LOGIN|FORM|TOP)/;

export function looksLikeNavigation(s: string): boolean {
  const t = s.replace(/^「|」$/g, '');
  const hasJa = /[ぁ-んァ-ヶ一-龠]/.test(t);
  // ★縦棒（｜ / |）が入っている一文は、ほぼ必ずページの題名かメニュー。
  //   実データで出た形：
  //     「総合建設業の花田工業株式会社｜大阪府｜和泉市」
  //     「サービス概要|公共工事の事なら大阪和泉市の市川工業和泉市から…」
  //   人が文章を書くときに縦棒は使わない。題名の区切り記号としてしか現れない。
  //   題名を引用しても「あなたの会社を読みました」にはならない。相手には名札を読み上げられただけに見える。
  if (/[｜|]/.test(t)) return true;
  // ★同じ英語の塊が2回続く形（CONTACTFORMCONTACTFORM）は、
  //   画像の代替文字と見出しを二重に拾ったときにしか起きない。本文には現れない。
  if (/([A-Z]{3,})\1/.test(t)) return true;
  if (hasJa) {
    for (const run of t.match(/[A-Z]{4,}/g) ?? []) {
      // 見出しの英単語が入っている塊（CONTACTFORM など）は本文ではない。
      if (HEADING_LABELS.test(run)) return true;
      // 見出しの語に無くても、6文字以上の大文字が日本語に地続きで並ぶのは本文ではない。
      // （HTML・HACCP・ISO のような普通に使う頭文字語を巻き込まない長さにしてある）
      if (run.length >= 6) return true;
    }
  }
  // ★ページの題名（「会社概要｜○○株式会社」など）も引用しない。
  //   これはその会社が自分について書いた文章ではなく、ページの名札。
  //   電話で読み上げると「『会社概要｜…』と書かれているのを読みました」になり、意味を成さない。
  if (NAV_WORDS.some((w) => new RegExp(`^${w}\\s*[｜|·・\\-—:：]`).test(t))) return true;
  // ★英語の見出しラベルが、そのまま日本語の本文にくっついている形。
  //   HPの見出しは「Company／会社概要」「GREETING／ごあいさつ」のように英語と日本語を並べて置く。
  //   本文だけを取り出すつもりが見出しごと拾うと、
  //     「『Company会社概要代表挨拶私たち株式会社○○は、創業以来…』と拝見しました」
  //   という文面になる。日本語の文が英単語に地続きで始まることはまずないので、形で落とす。
  //
  //   ★ただし「SNS運用の自動化」「AI導入の相談」「EC構築」のように、
  //     頭文字語（全部大文字）で始まる日本語の文はふつうにある。これを落とすと商品名まで消える。
  //     見出しラベルは「Company」「Greeting」のように頭だけ大文字の英単語なので、そちらだけを落とす。
  if (/^[A-Z][a-z]{2,}(?=[ぁ-んァ-ヶ一-龠])/.test(t)) return true;
  // メニューの見出しは、英語の大文字（GREETING / BUSINESS / COMPANY）が日本語に直接くっつく形で並ぶ。
  // 普通の文章の中で、大文字だけの語が日本語に地続きで2つ以上出てくることはまずない。
  //
  // ★ただし「大文字の語が2つ以上」だけでは落としすぎる。
  //   「HTML制作とISO9001に基づく品質管理を自社で行っています」は
  //   まっとうな本文なのに、HTML と ISO の2つで見出し扱いになっていた。
  //   本文に出てくる頭文字語（HTML・ISO・EC・AI）と、見出しの名札（COMPANY・STAFF）は違う。
  //   だから「2つ以上あり、かつ少なくとも1つが見出しの名札」に限る。
  const upperRuns = t.match(/[A-Z]{3,}/g) ?? [];
  if (upperRuns.length >= 2 && /[ぁ-んァ-ン一-龥]/.test(t) && upperRuns.some((r) => HEADING_LABELS.test(r))) return true;
  // 日本語のメニュー語が3つ以上並んでいる場合も、本文ではなくメニュー。
  return NAV_WORDS.filter((w) => t.includes(w)).length >= 3;
}

/**
 * 一文に切り分ける。短すぎる断片は事実として使えないので落とす。
 *
 * ★長すぎる一文は、途中で切って引用しない。
 *   以前は60文字で機械的に切っていたため、
 *   「…同じ断面をもつ形状の製品を製造するこ」のように語の途中で終わる文面ができていた。
 *   途中で切れた文を相手に読み上げるくらいなら、その一文は使わないほうがよい。
 *
 * ★さらに、読点で切るのもやめた。
 *   「安全と安心、倫理的価値観を持つ判断基準を念頭に、物流という血流を滞らせる」のように、
 *   読点で切ると文法的には途中で終わった節になる。別の目で監査したところ、
 *   上位20社のうち7社でこの形の引用が見つかった。読み上げれば必ず不自然になる。
 *   引用するのは「。」または改行で終わる完結した一文が、そのまま長さに収まるときだけ。
 *   収まらないならその一文は使わない（引用が減ることより、切れた文を送らないことを優先する）。
 */
const QUOTE_MAX = 60;
const QUOTE_MIN = 6;

function trimToNaturalEnd(s: string): string | null {
  return s.length <= QUOTE_MAX ? s : null;
}

/**
 * どの会社のHPにも必ず書いてある挨拶・定型句。
 *
 * ★これを「その会社が書いた事実」として引用すると、
 *   「サイトには『どうぞよろしくお願いいたします』とも書かれていましたね」という文面になる。
 *   読んだ証拠にならないどころか、相手に「何も読んでいない」と伝わる。
 */
const BOILERPLATE =
  /(よろしくお願い|宜しくお願い|お願い申し上げ|何卒|ありがとうございま|御礼申し上げ|お気軽に(ご相談|お問い合わせ|お電話)|詳しくはこちら|一覧はこちら|続きを読む|無断転載|copyright|all rights reserved|プライバシーポリシー|当サイトについて)/i;

/**
 * 引用として成立しない断片かどうか。
 *
 * ★実データで見つかった壊れ方：
 *     「」の感謝の気持ちを伝え続け、…心から願っております」
 *   相手のHPに鉤括弧が入っていたため、切り分けたときに閉じ括弧だけが頭に残った。
 *   このまま送ると、文の始まりが壊れた文面が相手の窓口に届く。
 *
 * ★直し方は「直す」ではなく「使わない」。
 *   括弧を勝手に足して整えると、相手が書いていない形に作り変えることになる。
 *   引用が1つ減るほうが、作り変えた文を送るより良い。
 */
export function isBrokenFragment(s: string): boolean {
  const t = s.trim();
  if (t.length === 0) return true;
  // 閉じ括弧・句読点から始まる＝文の途中を切り取ったもの。
  if (/^[」』）)】〕》、。・…]/.test(t)) return true;
  // ★助詞・接続の言葉から始まる一文は、日本語として存在しない。文の途中を切り取っている。
  //   実データで出た形：「を目指して国内リサイクル法に基づいた」
  //   これをそのまま引用すると「『を目指して…』という記載も読んでいます」になる。
  if (/^(を|が|に|へ|と|で|も|は|の|や|から|まで|より|など|ため|こと|という|ながら|つつ|ただし)/.test(t)) return true;
  // 括弧の数が合わない＝どこかで切れている。勝手に足して整えず、使わない。
  const pairs: [RegExp, RegExp][] = [
    [/「/g, /」/g],
    [/『/g, /』/g],
    [/（/g, /）/g],
    [/\(/g, /\)/g],
    [/【/g, /】/g],
  ];
  for (const [open, close] of pairs) {
    if ((t.match(open) ?? []).length !== (t.match(close) ?? []).length) return true;
  }
  return false;
}

/**
 * 引用の候補として使えない一文かどうか（引用を選ぶときだけに使う、厳しめの判定）。
 *
 * ★isBrokenFragment との違い。
 *   isBrokenFragment … 文脈に関係なく「これは壊れている」と言い切れるもの。
 *                       出来上がった文面の点検にも使える。
 *   looksBroken      … 引用の候補が何十本もある中から選ぶときだけの、厳しめの足切り。
 *                       ここでは「文らしくないものは落とす」で構わない。
 *                       落としても別の一文を選べばよく、引用が1本減るだけだから。
 *   ★この厳しめの判定を、出来上がった文面の点検に使ってはいけない。
 *     文面には商品名（例「LP（ランディングページ）制作」）のような、
 *     漢字で終わる正しい言葉が鉤括弧付きで入っている。
 *     これを「壊れた引用」と数えると、直しようのない不合格が出続ける。
 */
export function looksBroken(s: string): boolean {
  const t = s.trim();
  if (isBrokenFragment(t)) return true;
  // ★終わりが助詞・接続で切れている一文も、文になっていない。
  //   実データで出た形：
  //     「また、お客様等の同意を事前に得た場合、又は法令に」   ← 「に」で切れている
  //     「…目的や機能により構造や取組からが異なって」         ← 「て」で切れている
  //     「どんな些細なことでも」                               ← 「も」で切れている
  if (/(を|が|に|へ|と|で|の|や|も|は|か|ば|て|、|・|ー)$/.test(t)) return true;
  // ★漢字・カタカナ・英数字で終わる一文は、たいてい見出しか項目名で、文になっていない。
  //   実データで出た形：
  //     「正栄工業株式会社の会社概要、沿革、表彰・受賞歴」     ← ページの説明文
  //     「成形部門では、射出成形・異形押出成形、そして金型の設計・製作」
  //   引用できる一文が1つ減るほうが、文になっていないものを送るより良い。
  if (/[一-龥ァ-ヶA-Za-z0-9０-９]$/.test(t)) return true;
  return false;
}

/**
 * 相手のHPの「個人情報の取り扱い」から拾った一文かどうか。
 *
 * ★実データで出た形：
 *     「また、お客様等の同意を事前に得た場合、又は法令に」（株式会社タイショーテクノ）
 *   これは会社が自分の仕事について書いた文章ではなく、法律上の掲示。
 *   引用すると「御社のプライバシーポリシーを読みました」と言っているのと同じで、
 *   相手には何を読まれたのか分からず、不気味さだけが残る。
 */
export function looksLikePrivacyNotice(s: string): boolean {
  return /(個人情報|同意を事前に得|法令に基づ|第三者に提供|利用目的|開示・訂正|保護方針|クッキー|Cookie)/i.test(s);
}

/**
 * 問い合わせページの「使い方の説明」から拾った一文かどうか。
 *
 * ★実データで出た形：
 *     「メールでのお問合せについては、下のお問合せフォームをご利用ください」（イズミセキュリティサービス）
 *     「数日経っても折り返しがない場合、システムの不具合により…」（和泉設備工業）
 *     「お急ぎの方はお電話（大阪本社）ください」（株式会社Trans Value）
 *   これは会社が自分の仕事について書いた文章ではなく、窓口の使い方の案内。
 *   引用すると「御社の問い合わせフォームの説明文を読みました」と言う文面になり、
 *   その会社を見て連絡したのではないことが相手に伝わってしまう。
 *
 * ★問い合わせフォームのページを読みに行く仕組みである以上、この文章は必ず混ざる。
 *   入口で落とすのが正しい。
 */
export function looksLikeContactInstruction(s: string): boolean {
  return /(フォームをご利用|フォームより|フォームから|折り返し|再度お電話|お電話ください|お電話にてご|メールにてご連絡|送信ボタン|必須項目|ご入力ください|入力してください|受付時間|営業時間外|自動返信|届いていない可能性|お急ぎの方)/.test(s);
}

/**
 * ホームページに置きっぱなしの「仮の文章」かどうか。
 *
 * ★実データで出た形（株式会社鐵心）：
 *     「何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している」
 *     「名前はまだない」
 *   夏目漱石『吾輩は猫である』。日本語サイトの制作中に入れる定番の仮文章で、
 *   消し忘れたまま公開されている。これを引用すると、
 *   相手のホームページの作りかけの部分を読み上げることになる。
 */
export function looksLikeDummyText(s: string): boolean {
  return /(吾輩は猫|名前はまだ|どこで生れた|とんと見当がつかぬ|薄暗いじめじめした|ニャーニャー|lorem ipsum|ダミーテキスト|サンプルテキスト|ここに文章が入ります|テストテスト)/i.test(s);
}

/** ページの見出しに使われる日本語。文の途中に出てきたら、見出しが本文にくっついている。 */
const JA_HEADING_WORDS =
  /(会社概要|企業概要|会社案内|事業内容|業務内容|製品紹介|サービス紹介|製品・サービス|取扱品目|導入事例|よくある質問|新着情報|お知らせ|採用情報|求人情報|サイトマップ|個人情報保護|こちら)/;

/**
 * 見出しと本文がくっついた一文かどうか。
 *
 * ★なぜ必要か。
 *   相手のHPを読むとき、見出しの箱と本文の箱が続けて置かれていると、
 *   区切り文字が無いまま1本の文字列になってしまう。実データで出た形：
 *     「製品・サービス紹介射出成形業務金型内部へ圧縮した樹脂を…」（ナガセテクノス）
 *     「着色加工業務バージン材・再生材へ着色のほか、…」（同）
 *     「会社概要はこちら介護業界を支え、明日を創ります」（有限会社はな）
 *     「道路工事「道路」といっても多種多様で…」（市川工業）
 *     「保有技術が豊富誤った加工方法によっては、…」（エムアイ工業）
 *   これを引用すると、相手は自分が書いた覚えのない文を読まされることになる。
 *
 * ★直さずに「使わない」。見出しを切り落として整えると、相手が書いていない形に作り変えることになる。
 */
export function looksLikeHeadingFusion(s: string): boolean {
  const t = s.replace(/^「|」$/g, '');
  // ①引用の中にさらに鉤括弧が入ると、二重の鉤括弧になって読めない。
  if (/[「」]/.test(t)) return true;
  // ②見出しの言葉が混ざっている。
  if (JA_HEADING_WORDS.test(t)) return true;
  // ③書き出しの8文字に、てにをはも句読点も無い＝先頭に見出しがくっついている。
  //   ふつうの日本語の文は、8文字も進めば必ず助詞か読点が現れる。
  //   （「・」は「製品・サービス」のような単語の区切りなので、句読点として数えない）
  const head = t.slice(0, 8);
  if (!/[をがにへとでもはのやかばるれた、。（）]/.test(head)) return true;
  // ④「豊富」「多彩」「万全」のあとに、続けて漢字・カタカナが来る形。
  //   見出し（例「保有技術が豊富」）の直後に本文が始まっているときに出る。
  if (/(豊富|多彩|万全)[一-龥ァ-ヶ]/.test(t)) return true;
  // ⑤見出しの終わりによく来る言葉の直後に、文の書き出しによく来る言葉が続く形。
  //   実データで出た形（秀英産業）：
  //     「…企画商品を多数開発常に市場のニーズを調査し、…」   ← 「開発」＋「常に」
  //     「…現有商品見直しに全力で対応お客様のニーズに…」     ← 「対応」＋「お客様」
  if (
    /(開発|対応|製造|販売|提供|実施|施工|加工|設計|生産|管理|点検|修理|導入|運用|工事)(常に|お客様|お客さま|私たち|当社|弊社|皆様|安心|高品質|信頼|地域|創業|各種|徹底|安全)/.test(t)
  ) {
    return true;
  }
  return false;
}

export function sentencesOf(v: unknown): string[] {
  const out: string[] = [];
  for (const raw of String(v ?? '').split(/[。\n]/)) {
    const s = raw.replace(/\s+/g, '').trim();
    if (s.length < QUOTE_MIN) continue;
    if (looksLikeNavigation(s)) continue;
    if (looksBroken(s)) continue;
    if (looksLikeHeadingFusion(s)) continue;
    if (looksLikePrivacyNotice(s)) continue;
    if (looksLikeContactInstruction(s)) continue;
    if (looksLikeDummyText(s)) continue;
    if (BOILERPLATE.test(s)) continue;
    const t = trimToNaturalEnd(s);
    if (t && t.length >= QUOTE_MIN) out.push(t);
  }
  return out;
}

/**
 * その会社自身が書いた言葉（事業内容・紹介文）。所在地や人数と違い、他社と被りにくい。
 *
 * ★「その会社が書いた文章」だけを返す。こちらの手元のメモは絶対に返さない。
 *   business_detail の欄には、CSVの「メモ」列のような
 *   こちらの営業記録（例「2026-07-28 人が応答/手応えC/取次で終了」）が
 *   入ってしまうことがある。それを引用すると、自分の営業メモを相手に読み上げる文面になる。
 *   だから business_detail_source が OFFICIAL_WEBSITE のときだけ引用する。
 *   出どころが記録されていない古いデータも引用しない（分からないものは使わない）。
 *
 * ★一言紹介（description）も同じ扱いにする。
 *   ここは以前、出どころを見ずにそのまま引用していた。そのせいで実際に次が起きた:
 *   HP候補として企業名鑑のページを読み、その題名「会社概要｜○○株式会社」を
 *   description に入れた。あとで「そこは本人のサイトではない」と分かってHP欄からは
 *   外したが、題名だけが残り、電話の書き出しで
 *   「『会社概要｜○○株式会社』と書かれているのを読み」と読み上げる文面ができていた。
 *   本人が書いていない文章を、本人に向かって読み上げる形になる。
 */
export function ownWords(c: Row): string[] {
  const detailFromOwnSite = String(c.business_detail_source ?? '') === 'OFFICIAL_WEBSITE';
  const descFromOwnSite = String(c.description_source ?? '') === 'OFFICIAL_WEBSITE';
  return [
    ...(detailFromOwnSite ? sentencesOf(c.business_detail) : []),
    ...(descFromOwnSite ? sentencesOf(c.description) : []),
  ];
}

/** 会社について書ける事実のすべて。自分の言葉が無いときの受け皿。 */
export function companyFacts(c: Row): string[] {
  const f: string[] = [...ownWords(c)];
  if (c.established_on) f.push(`${String(c.established_on).slice(0, 4)}年から事業を続けておられる`);
  if (c.employees_estimate) f.push(`${c.employees_estimate}名ほどの体制でいらっしゃる`);
  if (c.prefecture) f.push(`${c.prefecture}で事業をされている`);
  return f;
}

// ── 「その一文を何社が書いているか」の数え上げ ────────────────────────────

let phraseUsersMap: Map<string, number> | null = null;

function key(s: string): string {
  return normalizeText(s).replace(/\s/g, '');
}

/**
 * 中身だけを取り出す。
 * 「東京都で建設」と「東京都の建設の会社」は、てにをはと「会社」を外せば同じ中身だと分かる。
 * 同じことを2回書いていないかを見るために使う。
 */
function core(s: string): string {
  return key(s)
    .replace(/[のでにをはがともやへ、]/g, '')
    .replace(/株式会社|有限会社|合同会社|会社|事業|です|ます|ている|ています/g, '');
}

/**
 * 全社の紹介文を1回だけ読み、同じ一文を何社が書いているかを数える。
 * 文面を作る前に1回呼ぶ。呼ばなくても文面は作れる（その場合は今までどおりの選び方になる）。
 */
export async function primeFactRarity(): Promise<number> {
  // ★出どころの欄も一緒に読む。読まないと ownWords が「出どころ不明」と判断して
  //   1文も返さず、数え上げが空になる（＝どの一文も珍しさが分からなくなる）。
  const rows = await all(
    'SELECT business_detail, business_detail_source, description, description_source FROM companies',
  );
  const m = new Map<string, number>();
  for (const r of rows) {
    for (const s of new Set(ownWords(r))) m.set(key(s), (m.get(key(s)) ?? 0) + 1);
  }
  phraseUsersMap = m;
  return m.size;
}

/** 数え直したいときに捨てる（テスト用）。 */
export function resetFactRarity(): void {
  phraseUsersMap = null;
}

/** その一文を書いている会社の数。0 = まだ数えていない。 */
export function phraseUsers(s: string): number {
  if (!phraseUsersMap) return 0;
  return phraseUsersMap.get(key(s)) ?? 0;
}

/** 数え終わっているか。採点のときに「未計測だから減点しない」を判断するのに使う。 */
export function rarityReady(): boolean {
  return phraseUsersMap !== null;
}

/**
 * その一文に「中身」がどれだけあるか。
 *
 * ★「東京都で不動産」は、たしかにその会社にしか書いていない文字列だが、
 *   所在地と業種を並べ直しただけで、こちらが何かを読み取った証拠にはならない。
 *   会社名・都道府県・市区町村・てにをはを外して、残った文字数を中身の量と見る。
 *   「内見予約の電話対応が営業時間外にも入り、取りこぼしている」は残りが多く、引用する価値がある。
 */
export const INFORMATIVE_MIN = 6;

export function informativeness(s: string, c: Row): number {
  let t = key(s);
  for (const w of [c.prefecture, c.city, c.name]) {
    const v = w ? key(String(w)) : '';
    if (v.length > 0) t = t.split(v).join('');
  }
  return t.replace(/株式会社|有限会社|合同会社|会社|事業|です|ます|[のでをにはがと、]/g, '').length;
}

// ── 事実の選び方 ─────────────────────────────────────────────

export type ChosenFacts = {
  /** 書き出しに使う事実。 */
  f0: string;
  /** 補足に使う事実。無ければ null。 */
  f1: string | null;
  /** 「その会社の仕事」を指す言葉。 */
  work: string | null;
  /** f0 / f1 がその会社にしか書いていない一文か。文面の採点に使う。 */
  unique: boolean;
  /**
   * f0 が「相手が自分のサイトに実際に書いた一文」か。
   *
   * ★false のときは、鉤括弧でくくって「という記載を拝見しました」と書いてはいけない。
   *   所在地・設立年・人数からこちらが組み立てた言い方
   *   （例「大阪府で事業をされている」）は、相手のサイトのどこにも書かれていない。
   *   実際に株式会社西辻工務店あての文面が
   *   「『大阪府で事業をされている』という記載を読み」となっていた。
   *   相手が書いていない文を、相手が書いたことにして送る形になる。
   */
  f0Quoted: boolean;
  /** f1 が「相手が自分のサイトに実際に書いた一文」か。理由は f0Quoted と同じ。 */
  f1Quoted: boolean;
  /** 会社の記録から取れた事実が1つも無く、当たり障りのない言い方に逃げたか。 */
  fallback: boolean;
};

/**
 * 会社ごとに、書き出しに使う事実を1つ・補足に使う事実を1つ選ぶ。
 * その会社にしか書いていない一文があれば必ずそちらを先に使う。
 *
 * ★avoid には「監査で使えないと判定された一文」を渡す。
 *   監査が「この引用は意味を成さない」と言った一文を、書き直しでもう一度選んでしまうと、
 *   何度書き直しても同じ文面が出てくる。除外できる口をここに1つだけ用意しておく。
 *   除外した結果、使える一文が1つも残らなかったときは、無理に別の文を作らず
 *   fallback（当たり障りのない言い方）に落ちる。作り話で埋めるよりそのほうがよい。
 */
export function chooseFacts(c: Row, seed: number, avoid: string[] = []): ChosenFacts {
  const banned = new Set(avoid.map((s) => key(s)));
  const drop = (list: string[]) => (banned.size === 0 ? list : list.filter((s) => !banned.has(key(s))));
  const own = drop(ownWords(c));
  const every = drop(companyFacts(c));

  // ★2段階で選ぶ。
  //   ①中身のある一文だけに絞る（所在地と業種を言い換えただけの文は落とす）
  //   ②その中で、書いている会社が一番少ない一文を選ぶ
  //     「地元で30年以上」のような、どの会社にも書いてある文を引用しても読み手には響かない。
  //     未計測（0）のときは判定できないので、1社扱いにして今までどおりの選び方に戻す。
  const base = own.length > 0 ? own : every;
  const informative = base.filter((s) => informativeness(s, c) >= INFORMATIVE_MIN);
  const candidates = informative.length > 0 ? informative : base;
  const users = (s: string) => phraseUsers(s) || 1;
  const minUsers = candidates.length > 0 ? Math.min(...candidates.map(users)) : 1;
  const pool = candidates.filter((s) => users(s) === minUsers);

  // 「その会社の仕事」に使う候補。
  // 事業内容の一番はじめの一文……ではなく、中身のある一文を使う。
  // 多くの会社紹介は「東京都で不動産。」から始まるが、電話で「『東京都で不動産』とのことですが」と
  // 言っても、何も読んでいないのと同じになる。
  //
  // ★ここも ownWords と同じ切り分け方を使う。
  //   以前はここだけ独自に切り分けていて、出どころの確認も、メニューの除外も、
  //   長さの上限も通っていなかった。そのため、引用の入口は塞いだのに、
  //   「その会社の仕事」の言い回しとして1000文字を超えるメニューの塊が
  //   そのまま営業文に入っていた（実際に6件できていた）。
  //   入口を1つ塞いでも、同じ文章を別の入口から取っていたら意味がない。
  const bdSentences = drop(ownWords(c));

  if (pool.length === 0) {
    const work0 = bdSentences.find((s) => informativeness(s, c) >= INFORMATIVE_MIN) ?? bdSentences[0] ?? null;
    return { f0: '公式サイトに書かれている内容', f1: null, work: work0, unique: false, fallback: true, f0Quoted: false, f1Quoted: false };
  }

  const f0 = variant(pool, seed, 7);

  // ★「その会社の仕事」は、引用に使った一文とは別の一文から取る。
  //   同じ一文を「拝見しました」と「とのことですが」で2回持ち出すと、
  //   その会社について書けることが1つしか無いように読めてしまう。
  const workPool = bdSentences.filter((s) => s !== f0 && informativeness(s, c) >= INFORMATIVE_MIN);
  const work =
    (workPool.length > 0 ? variant(workPool, seed, 3) : null) ??
    bdSentences.find((s) => informativeness(s, c) >= INFORMATIVE_MIN) ??
    bdSentences[0] ??
    null;
  // 補足は、同じ「その会社だけの一文」から取れなければ、他の事実から取る。
  const rest = pool.filter((x) => x !== f0);
  // 補足も、中身のある一文を先に探す。
  const restInformative = candidates.filter((x) => x !== f0);
  const restAll = rest.length > 0 ? rest : restInformative.length > 0 ? restInformative : every.filter((x) => x !== f0);
  // ★1つ目とほぼ同じ内容の一文は補足にしない。
  //   「東京都で建設」と「東京都の建設の会社」を並べると、同じことを2回言っただけの文面になる。
  //   てにをはと「会社」を外して比べると、この2つは同じ中身だと分かる。
  const c0 = core(f0);
  const distinct = restAll.filter((x) => {
    const cx = core(x);
    if (cx.length === 0 || c0.length === 0) return false;
    return !cx.includes(c0) && !c0.includes(cx) && similarity(x, f0) < 0.5;
  });
  const f1 = distinct.length > 0 ? variant(distinct, seed, 4) : null;

  // ★「相手が実際に自分のサイトに書いた一文」だけを引用してよい。
  //   companyFacts が足す所在地・設立年・人数の言い方は、こちらが組み立てた文なので、
  //   鉤括弧でくくって「という記載を拝見しました」と書いてはいけない。
  const ownKeys = new Set(ownWords(c).map((s) => key(s)));
  return {
    f0,
    f1,
    work,
    unique: rarityReady() && own.length > 0 && minUsers === 1,
    fallback: false,
    f0Quoted: ownKeys.has(key(f0)),
    f1Quoted: f1 !== null && ownKeys.has(key(f1)),
  };
}
