import type { CompanyInput } from './sales/ingest';
import type { JobInput } from './jobs/ingest';

/**
 * テスト用のデータ。
 *
 * わざと壊れたデータを混ぜてある。
 * 「壊れたデータをちゃんと弾けるか」を確かめるのが目的なので、
 * ここの件数を変えたら scripts/test-*.ts の期待値も一緒に直すこと。
 *
 * 乱数は使わない。何度実行しても同じデータになる。
 */

// ---------------------------------------------------------------- 会社

/** わざと問題を仕込んだ会社。期待する結果をコメントに書いてある。 */
const COMPANY_FIXTURES: (CompanyInput & { _expect: string })[] = [
  // --- 重複（法人番号が同じ。1社にまとまるはず） ---
  { _expect: 'DUP_CN', name: '株式会社さくら不動産', corporateNumber: '1234567890123', address: '大阪府大阪市中央区本町1-1-1', website: 'https://sakura-fudousan.example.jp', phone: '06-1234-5678', email: 'info@sakura-fudousan.example.jp', businessDetail: '賃貸仲介と売買仲介。内見予約の電話対応に人手を取られている。', employeesEstimate: 12, source: 'TEST' },
  { _expect: 'DUP_CN', name: 'さくら不動産（株）', corporateNumber: '1234567890123', address: '大阪府大阪市中央区本町一丁目1-1', website: 'https://sakura-fudousan.example.jp', phone: '06-1234-5678', source: 'TEST' },

  // --- 重複（法人番号なし・同名同住所。1社にまとまるはず） ---
  { _expect: 'DUP_NA', name: '有限会社みどり工務店', address: '大阪府堺市北区新金岡町2-2-2', website: 'https://midori-koumuten.example.jp', phone: '072-222-3333', businessDetail: 'リフォームと外壁塗装。見積り依頼の管理が紙。', employeesEstimate: 8, source: 'TEST' },
  { _expect: 'DUP_NA', name: '（有）みどり工務店', address: '大阪府堺市北区新金岡町 2-2-2', phone: '072-222-3333', source: 'TEST' },

  // --- 電話番号が壊れている（phone_valid=0 になるはず） ---
  { _expect: 'BAD_PHONE', name: '株式会社テスト電話短い', address: '東京都新宿区西新宿1-1-1', phone: '03-1234', email: 'info@denwa-mijikai.example.jp', website: 'https://denwa-mijikai.example.jp', businessDetail: 'ネット通販の運営。', source: 'TEST' },
  { _expect: 'BAD_PHONE', name: '株式会社テスト電話ゼロなし', address: '東京都渋谷区渋谷2-2-2', phone: '9012345678', website: 'https://zero-nashi.example.jp', businessDetail: '飲食店を3店舗運営。予約は電話のみ。', source: 'TEST' },
  { _expect: 'BAD_PHONE', name: '株式会社テスト電話桁多い', address: '愛知県名古屋市中区栄3-3-3', phone: '090-1234-56789', website: 'https://keta-ooi.example.jp', businessDetail: '美容室2店舗。', source: 'TEST' },

  // --- メールが壊れている（email_valid=0 になるはず） ---
  { _expect: 'BAD_EMAIL', name: '株式会社テストメール見本', address: '福岡県福岡市博多区博多駅前1-1-1', email: 'info@example.com', website: 'https://mihon-mail.example.jp', phone: '092-111-2222', businessDetail: '建設業。職人の手配を電話とFAXで回している。', source: 'TEST' },
  { _expect: 'BAD_EMAIL', name: '株式会社テストメール返信不可', address: '北海道札幌市中央区大通西1-1', email: 'noreply@henshin-fuka.example.jp', website: 'https://henshin-fuka.example.jp', phone: '011-222-3333', businessDetail: '学習塾を運営。問い合わせ対応に手が回らない。', source: 'TEST' },
  { _expect: 'BAD_EMAIL', name: '株式会社テストメール形が違う', address: '宮城県仙台市青葉区中央1-1', email: 'info-at-katachi.example.jp', website: 'https://katachi.example.jp', phone: '022-333-4444', businessDetail: '運送業。配車の連絡が電話中心。', source: 'TEST' },

  // --- HPと別会社のメール／フォーム（捨てられるはず） ---
  { _expect: 'OTHER_DOMAIN', name: '株式会社ドメイン違い', address: '京都府京都市中京区烏丸通1-1', website: 'https://domain-chigai.example.jp', email: 'info@zenzen-betsu-kaisha.example.net', contactFormUrl: 'https://zenzen-betsu-kaisha.example.net/contact', phone: '075-444-5555', businessDetail: 'ECサイトで雑貨を販売。商品説明の作成が追いつかない。', source: 'TEST' },
  { _expect: 'OTHER_DOMAIN', name: '株式会社ポータル掲載', address: '兵庫県神戸市中央区三宮町1-1', website: 'https://portal-keisai.example.jp', email: 'contact@matome-portal.example.net', phone: '078-555-6666', businessDetail: '中古車の販売と買取。', source: 'TEST' },

  // --- 営業お断り（no_sales_flag=1 になるはず） ---
  { _expect: 'NO_SALES', name: '株式会社えいぎょうおことわり', address: '東京都港区赤坂1-1-1', website: 'https://okotowari.example.jp', phone: '03-9999-1111', email: 'info@okotowari.example.jp', pageText: '当社では営業目的のお問い合わせはお断りしております。', businessDetail: 'ITサービスの受託開発。', source: 'TEST' },
  { _expect: 'NO_SALES', name: '株式会社セールスおことわり', address: '東京都千代田区丸の内1-1-1', website: 'https://sales-ng.example.jp', phone: '03-9999-2222', pageText: '営業・セールスのご連絡はご遠慮ください。', businessDetail: '不動産の管理。', source: 'TEST' },
  { _expect: 'NO_SALES', name: '株式会社勧誘禁止', address: '神奈川県横浜市西区みなとみらい1-1', website: 'https://kanyu-kinshi.example.jp', phone: '045-999-3333', pageText: '営業の電話はご遠慮願います。', businessDetail: '飲食店の運営。', source: 'TEST' },

  // --- 会社名が無い（受け付けないはず） ---
  { _expect: 'REJECT', name: '   ', address: '東京都中央区銀座1-1-1', source: 'TEST' },

  // --- 連絡手段が全く無い（MANUAL または SKIP になるはず） ---
  { _expect: 'NO_CONTACT', name: '株式会社連絡先不明', address: '新潟県新潟市中央区東大通1-1', businessDetail: '製造業。', source: 'TEST' },

  // --- フォームだけある ---
  { _expect: 'FORM_ONLY', name: '株式会社フォームのみ', address: '広島県広島市中区紙屋町1-1', website: 'https://form-only.example.jp', contactFormUrl: 'https://form-only.example.jp/contact', businessDetail: 'ECサイトを2つ運営。広告の運用まで手が回らない。', employeesEstimate: 15, source: 'TEST' },

  // --- 想定どおりの良い相手（不動産・電話が有効） ---
  { _expect: 'GOOD_PHONE', name: '株式会社ひまわり住宅', corporateNumber: '2234567890124', address: '大阪府吹田市江坂町1-1-1', website: 'https://himawari-jutaku.example.jp', phone: '06-6333-4444', email: 'info@himawari-jutaku.example.jp', representative: '山田太郎', establishedOn: '2005-04-01', employeesEstimate: 25, businessDetail: '新築戸建ての販売と賃貸仲介。内見予約の電話が営業時間外にも多く、取りこぼしている。', description: '創業20年。地域密着の不動産会社。', source: 'TEST' },
];

const PREFS = ['東京都', '大阪府', '愛知県', '福岡県', '北海道', '神奈川県', '兵庫県', '京都府', '広島県', '宮城県'];

/** 業種ごとの、ありそうな事業内容。ここから100件まで機械的に作る。 */
const PROFILES: { kind: string; detail: string; site: string }[] = [
  { kind: '不動産', detail: '賃貸仲介と管理。内見予約の電話対応が営業時間外にも入り、取りこぼしている。', site: 'fudousan' },
  { kind: '飲食', detail: '居酒屋を2店舗運営。予約の電話が忙しい時間に重なる。求人も出している。', site: 'inshoku' },
  { kind: '建設', detail: 'リフォームと外壁塗装。見積り依頼の管理が手作業。職人を募集中。', site: 'kensetsu' },
  { kind: 'EC', detail: 'ネットショップで日用品を販売。商品説明とレビュー対応が追いつかない。', site: 'ec' },
  { kind: '美容', detail: '美容室を運営。予約はホットペッパー任せで、リピートの声かけができていない。', site: 'biyou' },
  { kind: '整体', detail: '整体院。予約の電話を施術中に取れないことがある。', site: 'seitai' },
  { kind: '学習塾', detail: '個別指導塾。問い合わせ対応と保護者への連絡に時間がかかる。', site: 'juku' },
  { kind: '運送', detail: '軽貨物の配送。配車の連絡が電話中心で、ドライバーを募集している。', site: 'unsou' },
  { kind: '製造', detail: '金属加工の町工場。図面の問い合わせ対応を社長が全部やっている。', site: 'seizou' },
  { kind: 'IT', detail: '受託でWebシステムを開発。自社サービスの集客ができていない。', site: 'it' },
  { kind: '士業', detail: '税理士事務所。顧問先からの質問対応に追われている。', site: 'shigyou' },
  { kind: '中古車', detail: '中古車の販売と買取。在庫の写真と説明文の作成が大変。', site: 'chuko' },
];

/** 同じ業種でも会社ごとに書いてあることは違う。似た文面が出ないよう、事業内容も1社ずつ変える。 */
const SCALE_NOTES = ['創業してまだ3年', '2代目が引き継いで5年', '地元で30年以上', '昨年2店舗目を出したところ', '社長と家族だけで運営', '若い社員が中心'];
const EXTRA_NOTES = [
  '休日の問い合わせに返せていない',
  '紹介と口コミだけで新規が来ている',
  'SNSは開設しただけで止まっている',
  '見積りの作成に毎回1時間かかる',
  '請求書の作成が月末に集中する',
  'ホームページを5年前から更新できていない',
  '新人教育に時間が取られている',
  '繁忙期だけ人手がまったく足りない',
];
/** 会社ごとの「うちはこれが強み」。実在の会社サイトにはこの手の一文が必ずある。 */
const STRENGTHS = [
  '相談から引き渡しまで同じ担当が付く',
  '見積りは当日中に出す',
  '土日も窓口を開けている',
  '写真と実測データを全部残して渡す',
  '職人を自社で抱えている',
  '仕入れを直接やっているので中間が無い',
  '引き渡し後のアフターを5年間無償で見る',
  '取引先の9割が既存客からの紹介',
  '小さい依頼ほど早く動く',
  '担当が全員10年以上の経験者',
  '見積り以外の追加費用を出さない',
];
const AREAS = ['市内中心部', '沿線沿いの3市', '県内全域', '近隣2県まで', '半径15km圏', '駅前商店街', '郊外の住宅地', '工業団地の周辺', '観光地の周辺', '旧市街', '新興住宅地', '港湾エリア', '大学の周辺'];

/**
 * 練習用の会社の「問い合わせフォームのページに書いてある文章」。
 *
 * ★フォームは、あるだけでは営業に使わない。
 *   そのフォーム自身が取引・提案の受付を書いているときだけ使う（form-policy.ts）。
 *   その分かれ道を練習データでも本物と同じ処理で通すために、
 *   実際のページ本文に相当する文章をここに置く。判定は必ず judgeFormPolicy に任せる。
 */
export const TEST_FORM_PAGE_TEXT: Record<string, string> = {
  株式会社フォームのみ:
    'お問い合わせフォームです。製品についてのご質問のほか、お取引のご相談や業務提携のご提案もこちらの窓口で受け付けております。担当者より順次ご連絡いたします。',
  株式会社建設テスト3:
    'お問い合わせはこちらのフォームからお願いいたします。なお、営業目的のお問い合わせはお断りしております。',
};

/**
 * 練習用の会社の事業内容は「その会社が自分のHPに書いた文章」という設定にする。
 *
 * ★なぜ明示するか。
 *   事業内容は、出どころが「その会社のHP本文」のときだけ営業文へ引用してよい（facts.ts）。
 *   出どころを書かないと「人が入れたメモ」扱いになり、練習データでは
 *   本物と同じ引用の経路がまったく通らないまま「文面OK」に見えてしまう。
 *   ここは決め打ちの合格ではなく、練習データの前提（HPに書いてある）を正しく申告するもの。
 */
export function buildTestCompanies(): CompanyInput[] {
  const out: CompanyInput[] = COMPANY_FIXTURES.map(({ _expect, ...c }) => ({
    ...c,
    businessDetailSource: c.businessDetail ? (c.businessDetailSource ?? 'OFFICIAL_WEBSITE') : null,
  }));
  let i = 0;
  while (out.length < 100) {
    const p = PROFILES[i % PROFILES.length];
    const n = i + 1;
    const pref = PREFS[i % PREFS.length];
    const slug = `${p.site}-${n}`;
    const detail = [
      `${pref}で${p.kind}`,
      p.detail.replace(/。$/, ''),
      `${STRENGTHS[(n * 7) % STRENGTHS.length]}のが特徴`,
      `${AREAS[(n * 5) % AREAS.length]}を中心に受けている`,
      SCALE_NOTES[n % SCALE_NOTES.length],
      EXTRA_NOTES[(n * 3) % EXTRA_NOTES.length],
    ].join('。') + '。';
    // 3件に1件はメールが無い（電話かフォームになる）。5件に1件はフォームも無い。
    const hasEmail = n % 3 !== 0;
    const hasForm = n % 5 !== 0;
    out.push({
      name: `株式会社${p.kind}テスト${n}`,
      corporateNumber: String(3000000000000 + n),
      address: `${pref}テスト市テスト町${(n % 9) + 1}-${(n % 5) + 1}-${(n % 7) + 1}`,
      website: `https://${slug}.example.jp`,
      phone: `0${(n % 8) + 2}-${String(1000 + n).slice(0, 4)}-${String(2000 + n * 3).slice(0, 4)}`,
      email: hasEmail ? `info@${slug}.example.jp` : null,
      contactFormUrl: hasForm ? `https://${slug}.example.jp/contact` : null,
      representative: `代表 ${n}`,
      establishedOn: `${1985 + (n % 35)}-0${(n % 9) + 1}-15`,
      employeesEstimate: [3, 8, 15, 40, 120, 350][n % 6],
      description: `${pref}の${p.kind}の会社。${SCALE_NOTES[n % SCALE_NOTES.length]}。`,
      businessDetail: detail,
      businessDetailSource: 'OFFICIAL_WEBSITE',
      pageText: `${detail} お問い合わせはお気軽にどうぞ。`,
      source: 'TEST',
    });
    i++;
  }
  return out;
}

// ---------------------------------------------------------------- 案件

/** わざと受けてはいけない案件を混ぜてある。 */
const JOB_FIXTURES: (JobInput & { _expect: string })[] = [
  { _expect: 'FULLTIME_HOURS', siteCode: 'LANCERS', title: '【急募】ECサイト運用スタッフ', description: '1日8時間、週5日で稼働できる方を募集します。商品登録と受注処理をお願いします。', budgetType: 'HOURLY', budgetMin: 1300, budgetMax: 1500, source: 'TEST' },
  { _expect: 'FULLTIME_HOURS', siteCode: 'CROWDWORKS', title: 'カスタマーサポート（フルタイム）', description: 'フルタイムで対応いただける方。実働8時間。チャットでの即レスをお願いします。', budgetType: 'HOURLY', budgetMin: 1200, budgetMax: 1400, source: 'TEST' },
  { _expect: 'ONSITE', siteCode: 'LANCERS', title: 'Webサイト改修（常駐）', description: '週3日、都内オフィスへ常駐いただける方。出社が必須です。', budgetType: 'FIXED', budgetMin: 300000, budgetMax: 400000, source: 'TEST' },
  { _expect: 'ONSITE', siteCode: 'CROWDWORKS', title: '撮影アシスタント', description: '現地作業となります。来社いただける方限定。', budgetType: 'FIXED', budgetMin: 30000, budgetMax: 50000, source: 'TEST' },
  { _expect: 'EMPLOYMENT', siteCode: 'LANCERS', title: 'Webデザイナー（正社員）', description: '正社員としての採用です。社会保険完備、試用期間3ヶ月。', budgetType: 'UNKNOWN', source: 'TEST' },
  { _expect: 'HOURLY_LABOR', siteCode: 'SHUFTI', title: 'データ入力', description: '時給1100円。稼働時間に応じてお支払いします。', budgetType: 'HOURLY', budgetMin: 1100, budgetMax: 1100, source: 'TEST' },
  { _expect: 'ILLEGAL', siteCode: 'LANCERS', title: '簡単な作業で高収入', description: '口座の貸出をお願いします。高額報酬、即日現金でお支払い。', budgetType: 'FIXED', budgetMin: 100000, budgetMax: 300000, source: 'TEST' },
  { _expect: 'IMPERSONATION', siteCode: 'CROWDWORKS', title: 'アカウント作成代行', description: '本人確認の代行をお願いします。他人名義での登録が必要です。', budgetType: 'FIXED', budgetMin: 50000, budgetMax: 80000, source: 'TEST' },
  { _expect: 'THIRD_PARTY_ACCOUNT', siteCode: 'LANCERS', title: 'SNS運用代行', description: '当社のアカウントをお貸しします。ログイン情報を共有しますので代理ログインで運用してください。', budgetType: 'FIXED', budgetMin: 40000, budgetMax: 60000, source: 'TEST' },
  { _expect: 'TOS_VIOLATION', siteCode: 'CROWDWORKS', title: '競合サイトのデータ収集', description: '競合サイトをスクレイピングして自動収集してください。CAPTCHAの突破も含みます。', budgetType: 'FIXED', budgetMin: 80000, budgetMax: 150000, source: 'TEST' },
  { _expect: 'FAKE_REVIEW', siteCode: 'COCONALA', title: 'レビュー投稿のお願い', description: '当社商品の高評価レビューを投稿していただける方。サクラではなく感想でOKです。', budgetType: 'FIXED', budgetMin: 3000, budgetMax: 5000, source: 'TEST' },
  { _expect: 'NO_AI', siteCode: 'LANCERS', title: 'ブログ記事作成（AI禁止）', description: '生成AIの使用は禁止です。手作業で執筆してください。5記事お願いします。', budgetType: 'FIXED', budgetMin: 15000, budgetMax: 25000, source: 'TEST' },
  { _expect: 'ADULT', siteCode: 'LANCERS', title: 'サイトのライティング', description: 'アダルトジャンルのサイトです。R-18表現を含みます。', budgetType: 'FIXED', budgetMin: 20000, budgetMax: 30000, source: 'TEST' },

  // --- 赤字になる案件（除外されるはず） ---
  { _expect: 'LOSS', siteCode: 'CROWDWORKS', title: 'SEO記事の作成', description: 'SEO記事を30記事お願いします。文字数は各3000文字程度です。', budgetType: 'FIXED', budgetMin: 3000, budgetMax: 3000, source: 'TEST' },
  { _expect: 'LOSS', siteCode: 'LANCERS', title: 'LP制作', description: 'LP制作をお願いします。デザインから実装まで。', budgetType: 'FIXED', budgetMin: 5000, budgetMax: 5000, source: 'TEST' },

  // --- 予算が書いていない（HOLD になるはず） ---
  { _expect: 'HOLD_NO_BUDGET', siteCode: 'LANCERS', title: 'X（旧Twitter）投稿文の作成', description: 'X投稿文を10本お願いします。予算はご相談させてください。', budgetType: 'UNKNOWN', source: 'TEST' },

  // --- 受けたい案件（APPLY 候補） ---
  { _expect: 'GOOD', siteCode: 'LANCERS', title: 'ECサイトの商品説明文の作成', description: 'Amazonの商品説明文を20件作成してください。商品説明のライティング経験がある方歓迎。固定報酬でお支払いします。', budgetType: 'FIXED', budgetMin: 60000, budgetMax: 90000, url: 'https://www.lancers.jp/work/detail/test-good-1', source: 'TEST' },
  { _expect: 'GOOD', siteCode: 'CROWDWORKS', title: 'GASでスプレッドシートの集計を自動化', description: 'GASを使ってスプレッドシートの集計を自動化してください。データ整理とレポートの出力まで。固定報酬。', budgetType: 'FIXED', budgetMin: 80000, budgetMax: 120000, url: 'https://crowdworks.jp/public/jobs/test-good-2', source: 'TEST' },
];

const JOB_PROFILES: { title: string; desc: string; min: number; max: number }[] = [
  { title: 'ブログのSEO記事作成', desc: 'SEO記事のライティングをお願いします。キーワードは当方で用意します。固定報酬。', min: 40000, max: 60000 },
  { title: 'X（旧Twitter）の投稿文作成', desc: 'X投稿の文章を作成してください。SNS運用の経験がある方。固定報酬でお支払いします。', min: 30000, max: 45000 },
  { title: 'LP制作（デザイン込み）', desc: 'LP制作をお願いします。構成のライティングから実装まで。固定報酬。', min: 150000, max: 250000 },
  { title: '商品説明文の作成', desc: 'ECの商品説明を作成してください。Amazonへの掲載用です。固定報酬。', min: 50000, max: 80000 },
  { title: 'キャッチコピーの作成', desc: 'キャッチコピーを複数案お願いします。コピーの経験がある方。固定報酬。', min: 25000, max: 40000 },
  { title: 'WordPressサイトの構築', desc: 'WordPressでサイト制作をお願いします。実装まで含みます。固定報酬。', min: 180000, max: 300000 },
  { title: '営業リストの作成', desc: '営業リストのリサーチと作成をお願いします。市場調査も含みます。固定報酬。', min: 45000, max: 70000 },
  { title: 'YouTube動画の台本作成', desc: '動画の台本・シナリオを作成してください。固定報酬でお支払いします。', min: 35000, max: 55000 },
  { title: 'サムネイル画像の作成', desc: 'サムネイルのデザインをお願いします。画像の作成が中心です。固定報酬。', min: 20000, max: 35000 },
  { title: 'データ分析とレポート作成', desc: 'データの分析と集計、レポートの作成をお願いします。固定報酬。', min: 60000, max: 100000 },
];

const JOB_SITES = ['LANCERS', 'CROWDWORKS', 'COCONALA', 'CRAUDIA'];

export function buildTestJobs(): JobInput[] {
  const out: JobInput[] = JOB_FIXTURES.map(({ _expect, ...j }) => j);
  let i = 0;
  while (out.length < 100) {
    const p = JOB_PROFILES[i % JOB_PROFILES.length];
    const n = i + 1;
    const site = JOB_SITES[i % JOB_SITES.length];
    const qty = (n % 5) + 1;
    out.push({
      siteCode: site,
      externalId: `test-${n}`,
      title: `${p.title}（${qty}件）`,
      description: `${p.desc} 分量は${qty}件です。納期はご相談ください。`,
      category: p.title,
      budgetType: 'FIXED',
      budgetMin: p.min,
      budgetMax: p.max,
      url: `https://example.jp/${site.toLowerCase()}/test-${n}`,
      postedAt: `2026-08-${String((n % 28) + 1).padStart(2, '0')}`,
      source: 'TEST',
    });
    i++;
  }
  return out;
}

/** テストで使う期待値。データを増やしたらここも直す。 */
export const TESTDATA_EXPECT = {
  companyInputs: 100,
  /** 会社名が空で受け付けないもの */
  companyRejected: 1,
  /** 重複としてまとまるもの（法人番号1組＋名前住所1組） */
  companyDuplicates: 2,
  /** 営業お断りの記載があるもの */
  companyNoSales: 3,
  /** 電話番号が壊れているもの */
  companyBadPhone: 3,
  /** メールが壊れているもの */
  companyBadEmail: 3,
  /** HPと別会社のメール・フォームを持つもの */
  companyOtherDomain: 2,
  jobInputs: 100,
  /** 文面から受けない理由が見つかるもの */
  jobExcludedByText: 13,
} as const;
