import { all, one, scalar, type Row } from '../lib/db/client';
import { auditCopy, type CopyAudit } from '../lib/sales/audit-copy';
import { loadOffers } from '../lib/catalog/sync';
import { initSettings } from '../lib/settings';
import { TESTDATA_EXPECT } from '../lib/testdata';
import { normalizeEmail, normalizePhone, sameOrganization, isOwnSiteUrl, similarity } from '../lib/text';
import { buildDedupeKey, normalizeCorporateNumber } from '../lib/sales/ingest';
import { detectNoSales } from '../lib/sales/nosales';
import { guessIndustry } from '../lib/industry';
import { senderIdentity } from '../lib/sales/sender-identity';
import { canOutreach } from '../lib/sales/guards';
import { looksLikeDirectoryPage, trustedByRegistry, verifyWebsiteIdentity } from '../lib/sales/identity';
import { looksLikeNavigation, ownWords, sentencesOf } from '../lib/sales/facts';
import { htmlToText, parseRobots, pickSubPagesFromUrls, robotsAllowsPath } from '../lib/sales/website';
import { sourceStatuses } from '../lib/sales/sources';
import { Suite, finish } from './_harness';

/**
 * 法人営業（SYSTEM A）の受入テスト。
 * npm run seed → npm run pipeline を先に実行しておくこと（npm test は自動でやる）。
 */

async function main() {
  await initSettings();

  // ---------------------------------------------------------------- 部品のテスト
  const p = new Suite('データの掃除（1件ずつの判定）');

  p.check('短すぎる電話番号を弾く', normalizePhone('03-1234').valid === false, normalizePhone('03-1234').reason);
  p.check('0で始まらない番号を弾く', normalizePhone('9012345678').valid === false, normalizePhone('9012345678').reason);
  p.check('桁が多すぎる番号を弾く', normalizePhone('090-1234-56789').valid === false, normalizePhone('090-1234-56789').reason);
  p.check('正しい固定電話は通す', normalizePhone('06-6333-4444').valid === true, String(normalizePhone('06-6333-4444').value));
  p.check('正しい携帯番号は通す', normalizePhone('090-1234-5678').valid === true, String(normalizePhone('090-1234-5678').value));

  p.check('見本用のメール（example.com）を弾く', normalizeEmail('info@example.com').valid === false, normalizeEmail('info@example.com').reason);
  p.check('返信できないメール（noreply）を弾く', normalizeEmail('noreply@a.example.jp').valid === false, normalizeEmail('noreply@a.example.jp').reason);
  p.check('形が違うメールを弾く', normalizeEmail('info-at-a.example.jp').valid === false, normalizeEmail('info-at-a.example.jp').reason);
  p.check('普通のメールは通す', normalizeEmail('info@himawari-jutaku.example.jp').valid === true, 'OK');

  p.check('HPと同じ会社のメールと認める', sameOrganization('https://a.example.jp/about', 'https://mail.a.example.jp') === true, 'サブドメインは同じ会社');
  p.check('別会社のドメインは認めない', sameOrganization('https://a.example.jp', 'https://b.example.net') === false, '別ドメイン');
  p.check('プレスリリースのページを会社HPとして扱わない', isOwnSiteUrl('https://prtimes.jp/main/html/rd/p/1.html') === false, 'prtimes.jp');
  p.check('求人サイトのページを会社HPとして扱わない', isOwnSiteUrl('https://en-gage.net/company/1') === false, 'en-gage.net');
  p.check('普通の会社サイトは会社HPとして扱う', isOwnSiteUrl('https://himawari-jutaku.example.jp/') === true, 'OK');

  p.check('営業お断りの表記を見つける', detectNoSales('当社では営業目的のお問い合わせはお断りしております。').found === true, '検出');
  p.check('普通の文では誤検出しない', detectNoSales('お問い合わせはお気軽にどうぞ。').found === false, '検出せず');

  p.check('法人番号は13桁だけ通す', normalizeCorporateNumber('1234567890123') === '1234567890123' && normalizeCorporateNumber('12345') === null, '13桁のみ');
  p.check('会社名の書き方が違っても同じ会社と分かる', buildDedupeKey('株式会社さくら不動産', '大阪府大阪市中央区本町1-1-1', '1234567890123') === buildDedupeKey('さくら不動産（株）', '大阪府大阪市中央区本町一丁目1-1', '1234567890123'), '法人番号が同じなら同じ鍵');

  p.check('業種を当てられる（不動産）', guessIndustry('株式会社ひまわり住宅', null, '新築戸建ての販売と賃貸仲介。').key === 'REAL_ESTATE', guessIndustry('株式会社ひまわり住宅', null, '新築戸建ての販売と賃貸仲介。').key);
  p.check('業種を当てられる（飲食）', guessIndustry('居酒屋テスト', null, '居酒屋を2店舗運営。予約の電話が多い。').key === 'RESTAURANT', guessIndustry('居酒屋テスト', null, '居酒屋を2店舗運営。').key);

  p.print();

  // ---------------------------------------------------------------- 取り込み結果
  const i = new Suite('会社の取り込み');
  const companies = await scalar("SELECT COUNT(*) FROM companies WHERE source = 'TEST'");
  i.eq('取り込めた会社数（入力100件 − 名前なし1件 − 重複2件）', companies, TESTDATA_EXPECT.companyInputs - TESTDATA_EXPECT.companyRejected - TESTDATA_EXPECT.companyDuplicates, '社');
  i.eq('重複した会社が1件にまとまっている', await scalar("SELECT COUNT(*) FROM companies WHERE corporate_number = '1234567890123'"), 1, '社');
  i.eq('名前と住所だけの重複もまとまっている', await scalar("SELECT COUNT(*) FROM companies WHERE name LIKE '%みどり工務店%'"), 1, '社');
  i.eq('会社名が空のものは登録されない', await scalar("SELECT COUNT(*) FROM companies WHERE TRIM(name) = ''"), 0, '社');

  i.eq('壊れた電話番号は使わない印がついている', await scalar("SELECT COUNT(*) FROM companies WHERE name LIKE '%テスト電話%' AND phone_valid = 1"), 0, '社');
  i.eq('壊れたメールは使わない印がついている', await scalar("SELECT COUNT(*) FROM companies WHERE name LIKE '%テストメール%' AND email_valid = 1"), 0, '社');
  i.eq('HPと別ドメインのメールは捨てられている', await scalar("SELECT COUNT(*) FROM companies WHERE name = '株式会社ドメイン違い' AND email IS NOT NULL"), 0, '社');
  i.eq('HPと別ドメインのフォームも捨てられている', await scalar("SELECT COUNT(*) FROM companies WHERE name = '株式会社ドメイン違い' AND contact_form_url IS NOT NULL"), 0, '社');
  // ★数えるのは練習用データだけ。本物のデータと混ぜて数えると期待値と合わないだけでなく、
  //   「練習の合格」と「本物の状態」が区別できなくなる。
  i.eq('営業お断りの会社に印がついている', await scalar("SELECT COUNT(*) FROM companies WHERE source = 'TEST' AND no_sales_flag = 1"), TESTDATA_EXPECT.companyNoSales, '社');
  i.atLeast('営業お断りの会社はNG名簿にも入っている', await scalar('SELECT COUNT(*) FROM ng_registry'), TESTDATA_EXPECT.companyNoSales, '件');
  i.print();

  // ---------------------------------------------------------------- 判断
  const j = new Suite('売るものと連絡手段の判断');
  j.eq('全社に読み取り結果がある', await scalar("SELECT COUNT(*) FROM company_analyses a JOIN companies c ON c.id = a.company_id WHERE c.source = 'TEST'"), companies, '社');
  j.eq('全社に点数がついている', await scalar("SELECT COUNT(*) FROM company_scores s JOIN companies c ON c.id = s.company_id WHERE c.source = 'TEST'"), companies, '社');

  const noSalesChannels = await all("SELECT ch.channel FROM channel_decisions ch JOIN companies c ON c.id = ch.company_id WHERE c.no_sales_flag = 1");
  j.check('営業お断りの会社には営業しない判断になる', noSalesChannels.every((r) => String(r.channel) === 'SKIP'), noSalesChannels.map((r) => String(r.channel)).join(',') || 'なし');

  const noContact = await one("SELECT ch.channel FROM channel_decisions ch JOIN companies c ON c.id = ch.company_id WHERE c.name = '株式会社連絡先不明'");
  j.check('連絡先が無い会社は自動営業に回さない', ['MANUAL', 'SKIP'].includes(String(noContact?.channel)), String(noContact?.channel));

  const formOnly = await one("SELECT ch.channel FROM channel_decisions ch JOIN companies c ON c.id = ch.company_id WHERE c.name = '株式会社フォームのみ'");
  j.eq('フォームしか無い会社はフォーム営業になる', String(formOnly?.channel), 'FORM');

  const badPhone = await all("SELECT ch.channel FROM channel_decisions ch JOIN companies c ON c.id = ch.company_id WHERE c.name LIKE '%テスト電話%'");
  j.check('電話番号が壊れている会社を電話営業に回さない', badPhone.every((r) => String(r.channel) !== 'PHONE'), badPhone.map((r) => String(r.channel)).join(','));

  const badEmail = await all("SELECT ch.channel FROM channel_decisions ch JOIN companies c ON c.id = ch.company_id WHERE c.name LIKE '%テストメール%'");
  j.check('メールが壊れている会社をメール営業に回さない', badEmail.every((r) => String(r.channel) !== 'EMAIL'), badEmail.map((r) => String(r.channel)).join(','));

  const realEstate = await one("SELECT o.offer_code FROM company_offers o JOIN companies c ON c.id = o.company_id WHERE c.name = '株式会社ひまわり住宅' AND o.sellable = 1 ORDER BY o.fit_score DESC LIMIT 1");
  j.check('不動産会社に売る商品が決まっている', realEstate !== null, String(realEstate?.offer_code ?? 'なし'));
  j.check('商品は1つに固定されていない（会社ごとに変わる）', (await scalar('SELECT COUNT(DISTINCT offer_code) FROM company_offers WHERE sellable = 1')) >= 3, `${await scalar('SELECT COUNT(DISTINCT offer_code) FROM company_offers WHERE sellable = 1')}種類`);

  const evNull = await scalar('SELECT COUNT(*) FROM company_scores WHERE expected_value IS NULL AND ev_unavailable_reason IS NULL');
  j.eq('期待値が出せないとき、理由を書かずに空にしていない', evNull, 0, '件');
  j.print();

  // ---------------------------------------------------------------- 文面
  const d = new Suite('文面の品質');
  const drafts = await all("SELECT d.*, c.name, c.business_detail FROM outreach_drafts d JOIN companies c ON c.id = d.company_id WHERE d.status = 'READY'");
  d.atLeast('使える文面が作られている', drafts.length, 10, '件');

  const maxSim = 0.6;
  let worst = 0;
  let worstPair = '';
  const personals = drafts.map((r) => ({ name: String(r.name), text: String(r.personal_text ?? '') }));
  for (let a = 0; a < personals.length; a++) {
    for (let b = a + 1; b < personals.length; b++) {
      const sim = similarity(personals[a].text, personals[b].text);
      if (sim > worst) {
        worst = sim;
        worstPair = `${personals[a].name} と ${personals[b].name}`;
      }
    }
  }
  d.check('使い回しの文面が無い（個別化した部分を全組み合わせで比較）', worst <= maxSim, `一番似ている組み合わせ: ${worstPair} = ${worst.toFixed(3)}（上限${maxSim}）`);

  d.eq('景表法などで問題になる表現が入った文面', await scalar("SELECT COUNT(*) FROM outreach_drafts WHERE status = 'READY' AND expression_ng <> '[]'"), 0, '件');

  const noPersonal = drafts.filter((r) => {
    const detail = String(r.business_detail ?? '').replace(/\s+/g, '');
    if (detail.length < 10) return false;
    // その会社の事業内容に書かれた語が、文面に1つも出てこないものを数える
    const parts = detail.split(/[。、]/).filter((x) => x.length >= 6);
    return parts.length > 0 && !parts.some((x) => String(r.body).includes(x.slice(0, 8)));
  });
  d.eq('その会社のことを1つも書いていない文面', noPersonal.length, 0, '件');

  const emailDrafts = await all("SELECT body FROM outreach_drafts WHERE channel = 'EMAIL' AND status = 'READY'");
  const identity = senderIdentity();
  if (identity.ok) {
    d.check('営業メールに法律で必要な項目が全部入っている', emailDrafts.every((r) => /配信.{0,4}停止|受け取りたくない/.test(String(r.body))), `${emailDrafts.length}件を確認`);
  } else {
    d.check('送信者情報が未設定ならメールの文面を作らない', emailDrafts.length === 0, `未設定なのに${emailDrafts.length}件作られている（不足: ${identity.missing.join('、')}）`);
  }

  const scripts = await all('SELECT * FROM call_scripts');
  d.atLeast('電話の台本が作られている', scripts.length, 1, '件');
  d.check('電話の台本に名乗りと用件が入っている', scripts.every((r) => String(r.opening).length > 10 && String(r.purpose).length > 10), `${scripts.length}件`);
  const distinctOpenings = new Set(scripts.map((r) => String(r.opening))).size;
  d.check('電話の台本が全社同じ文章になっていない', distinctOpenings >= Math.min(5, scripts.length), `${distinctOpenings}種類 / ${scripts.length}件`);
  d.print();

  // ---------------------------------------------------------------- 関門
  const g = new Suite('営業する直前の関門');
  const noSalesCompany = await one("SELECT id FROM companies WHERE no_sales_flag = 1 LIMIT 1");
  if (noSalesCompany) {
    const r = await canOutreach(Number(noSalesCompany.id), 'EMAIL');
    g.check('営業お断りの会社は関門を通らない', r.allowed === false, r.reasonJa);
    g.check('止めた理由に営業お断りが含まれる', r.blockedBy.includes('NO_SALES_FLAG'), r.blockedBy.join(','));
  }
  const good = await one("SELECT id FROM companies WHERE name = '株式会社ひまわり住宅'");
  if (good) {
    const r = await canOutreach(Number(good.id), 'PHONE');
    g.check('条件を満たした会社でも、最後の関門で必ず止まる', r.allowed === false, r.reasonJa);
    g.check('止まる理由が「実行する処理が無い」であること', r.blockedBy.includes('EXTERNAL_GATE'), r.blockedBy.join(','));
  }
  // 「見送った（SKIPPED）」の記録は何度残っても営業ではないので数えない。
  // 数えるのは実際の営業予定（送る予定・人の承認待ち）だけ。ここが2件以上＝重複営業。
  g.eq(
    '同じ会社に2回以上の営業予定が立っていない',
    await scalar("SELECT COUNT(*) FROM (SELECT company_id FROM outreach_logs WHERE action IN ('PLANNED','QUEUED_FOR_APPROVAL') GROUP BY company_id HAVING COUNT(*) > 1)"),
    0,
    '社',
  );
  g.eq(
    '同じ会社が承認待ちに2件以上並んでいない',
    await scalar("SELECT COUNT(*) FROM (SELECT ref_id FROM approval_queue WHERE kind = 'FORM' GROUP BY ref_id HAVING COUNT(*) > 1)"),
    0,
    '社',
  );
  g.print();

  // ---------------------------------------------------------------- ホームページの照合
  // ★別会社のHPを掴んだまま営業文を書くのが、このシステムで一番大きい事故。
  //   ここは通信をしないで判定の正しさだけを確かめる（テストが外へ出て行かないようにするため）。
  const w = new Suite('ホームページが本当にその会社のものか');

  const HIMAWARI = { name: '株式会社ひまわり住宅', corporateNumber: '1234567890123', address: '東京都新宿区西新宿1-1-1', phone: '03-1234-5678', representative: '山田太郎' };

  // ① 法人番号が載っていれば一発で確定する
  const byNumber = verifyWebsiteIdentity(HIMAWARI, {
    url: 'https://himawari-jutaku.co.jp/',
    title: 'ひまわり住宅',
    text: '会社概要 商号 株式会社ひまわり住宅 法人番号 1234567890123 所在地 東京都新宿区西新宿1-1-1 新築戸建ての販売と賃貸仲介を行っています。',
  });
  w.check('法人番号が一致すれば本人のHPと確認できる', byNumber.verdict === 'MATCH', byNumber.reason);

  // ② 別の法人番号が載っていたら、他がどれだけ合っていても採用しない
  const wrongNumber = verifyWebsiteIdentity(HIMAWARI, {
    url: 'https://example-corp.co.jp/',
    title: '株式会社ひまわり住宅',
    text: '株式会社ひまわり住宅 東京都新宿区西新宿1-1-1 TEL 03-1234-5678 法人番号 9999999999999 代表 山田太郎',
  });
  w.check('ページの法人番号が違えば採用しない', wrongNumber.verdict === 'MISMATCH', wrongNumber.reason);

  // ③ 会社名だけ一致しても足りない（同名の別会社があるため）
  const nameOnly = verifyWebsiteIdentity(
    { name: '株式会社ひまわり住宅' },
    { url: 'https://himawari.example.jp/', title: 'ひまわり住宅', text: 'ひまわり住宅のページです。わたしたちは地域に根ざした住まいづくりをしています。お気軽にご相談ください。' },
  );
  w.check('会社名が合っただけでは採用しない', nameOnly.verdict === 'UNKNOWN', `${nameOnly.verdict} / ${nameOnly.reason}`);

  // ④ 会社名＋電話番号のように2種類そろえば採用する
  const twoKinds = verifyWebsiteIdentity(
    { name: '株式会社ひまわり住宅', phone: '03-1234-5678' },
    { url: 'https://himawari-jutaku.co.jp/', title: 'ひまわり住宅', text: '株式会社ひまわり住宅 お問い合わせ TEL 03-1234-5678 新築戸建ての販売と賃貸仲介を行っています。' },
  );
  w.check('会社名と電話番号がそろえば採用する', twoKinds.verdict === 'MATCH', twoKinds.reason);

  // ⑤ まったく別の会社のページは弾く
  const other = verifyWebsiteIdentity(HIMAWARI, {
    url: 'https://sakura-kensetsu.co.jp/',
    title: '株式会社さくら建設',
    text: '株式会社さくら建設は大阪府大阪市で土木工事を行っています。創業50年の実績があります。お問い合わせはこちら。',
  });
  w.check('まったく別の会社のページは弾く', other.verdict === 'MISMATCH', other.reason);

  // ⑥ 求人サイト・プレスリリースはそもそもHPとして見ない
  const jobSite = verifyWebsiteIdentity(HIMAWARI, {
    url: 'https://www.wantedly.com/companies/himawari',
    title: '株式会社ひまわり住宅の採用',
    text: '株式会社ひまわり住宅 東京都新宿区西新宿1-1-1 法人番号 1234567890123 求人情報',
  });
  w.check('求人サイトはHPとして扱わない', jobSite.verdict === 'MISMATCH', jobSite.reason);

  // ⑦ 中身が読めなかったページは「分からない」にする（0や「合っている」で埋めない）
  const empty = verifyWebsiteIdentity(HIMAWARI, { url: 'https://himawari-jutaku.co.jp/', title: null, text: '準備中' });
  w.check('中身が読めないときは「分からない」にする', empty.verdict === 'UNKNOWN', empty.reason);

  // ⑧ 国が法人番号にひも付けて公開しているHPだけは、読まずに本人のものとして扱える
  w.check('gBizINFOのHPは確認済みとして扱える', trustedByRegistry('GBIZINFO', '1234567890123') === true, '');
  w.check('Google PlacesのHPは確認済みにしない', trustedByRegistry('GOOGLE_PLACES', '1234567890123') === false, '');
  w.check('法人番号が無ければgBizINFOでも確認済みにしない', trustedByRegistry('GBIZINFO', null) === false, '');

  // ⑨ robots.txt で断られている場所は読まない。読めなかったときも読まない。
  const robots = parseRobots('User-agent: *\nDisallow: /private/\nAllow: /private/public/\nCrawl-delay: 3');
  const rules = { usable: true, reason: '', ...robots };
  w.check('robots.txt で禁止された場所は読まない', robotsAllowsPath(rules, '/private/secret.html') === false, '');
  w.check('robots.txt で許可し直された場所は読む', robotsAllowsPath(rules, '/private/public/a.html') === true, '');
  w.check('robots.txt に書かれていない場所は読む', robotsAllowsPath(rules, '/company/about.html') === true, '');
  w.check('Crawl-delay を守る（3秒）', rules.crawlDelayMs >= 3000, `${rules.crawlDelayMs}ミリ秒`);
  w.check(
    'robots.txt が読めなかったときは読まない',
    robotsAllowsPath({ usable: false, reason: '', allow: [], disallow: [], crawlDelayMs: 1500, sitemaps: [] }, '/') === false,
    '',
  );

  // ⑩ HTMLから文章を取り出せる（台本や見た目の指定は落とす）
  const text = htmlToText('<html><head><style>.a{color:red}</style><script>var x=1;</script></head><body><h1>株式会社ひまわり住宅</h1><p>新築戸建ての販売</p></body></html>');
  w.check('HTMLから文章だけを取り出せる', text.includes('株式会社ひまわり住宅') && text.includes('新築戸建ての販売'), text.slice(0, 60));
  w.check('画面の指定やプログラムは文章に混ぜない', !text.includes('color:red') && !text.includes('var x'), text.slice(0, 60));

  // ⑩-2 メニューが読めないHPでも、サイトマップから会社概要へたどり着ける
  const smRobots = parseRobots('User-agent: *\nDisallow:\nSitemap: https://example.co.jp/sitemap.xml');
  w.check('robots.txt に書かれたサイトマップの場所を拾える', smRobots.sitemaps.includes('https://example.co.jp/sitemap.xml'), smRobots.sitemaps.join(','));
  const picked = pickSubPagesFromUrls(
    ['https://example.co.jp/', 'https://example.co.jp/news/2026', 'https://example.co.jp/company/about', 'https://example.co.jp/contact/'],
    'https://example.co.jp/',
  );
  w.check('サイトマップから会社概要のページを選べる', picked.about === 'https://example.co.jp/company/about', String(picked.about));
  w.check('サイトマップからお問い合わせのページを選べる', picked.contact === 'https://example.co.jp/contact/', String(picked.contact));

  // ⑪ 取得元の「あと何をすれば使えるか」が、鍵の無いものには必ず書いてある
  const missing = sourceStatuses().filter((s) => !s.configured);
  w.check('鍵が無い取得元には、次にやることが必ず書いてある', missing.every((s) => (s.needs ?? '').length > 10), missing.map((s) => s.code).join(',') || 'すべて設定済み');
  w.check('取得元はすべて読み取り専用', sourceStatuses().every((s) => s.readOnly === true), '');

  // ⑫ 実際のデータで、確認していないHPを「確認済み」と言っていないこと
  w.eq(
    '照合していないのに「確認済み」になっている会社はいない',
    await scalar("SELECT COUNT(*) FROM companies WHERE website_verified = 1 AND website_checked_at IS NULL"),
    0,
    '社',
  );
  w.eq(
    '照合に落ちたのにHPが残っている会社はいない',
    await scalar('SELECT COUNT(*) FROM companies WHERE website_reject_reason IS NOT NULL AND website IS NOT NULL'),
    0,
    '社',
  );

  // ⑬ 未確認のHPしか無い会社の文面に「公式サイトを拝見しました」と書いていないこと
  const unverifiedDrafts = await all(
    `SELECT d.body FROM outreach_drafts d JOIN companies c ON c.id = d.company_id
      WHERE COALESCE(c.website_verified, 0) = 0`,
  );
  w.eq(
    '確かめていないHPを「公式サイトを拝見しました」と書いていない',
    unverifiedDrafts.filter((r) => /公式サイトを拝見|ホームページを読み|サイトを読み|サイトで「|サイトにある|サイトには「/.test(String(r.body ?? ''))).length,
    0,
    '通',
  );
  w.print();

  // ---------------------------------------------------------------- 実際に起きた事故の再発防止
  // ★どちらも、10社を目で見て初めて分かった不具合。
  //   数字（KPI）は「問題なし」と出ていた。数字だけ見ていると気づけない種類の事故なので、
  //   ここで必ず機械が引っかかるようにしておく。
  const r = new Suite('前に起きた事故の再発防止');

  // ① こちらの架電メモを、その会社が書いた事実として営業文に引用してしまった
  //    例:「2026-07-28 人が応答/手応えC/取次で終了」→ 電話台本がこれを相手に読み上げていた
  r.check(
    'こちらのメモは、その会社が書いた事実として使わない',
    ownWords({ business_detail: '2026-07-28 人が応答/手応えC/取次で終了', business_detail_source: 'MANUAL', description: null }).length === 0,
    '出どころがHP本文でないものは引用しない',
  );
  r.check(
    'HP本文から取った事業内容は、その会社が書いた事実として使える',
    ownWords({ business_detail: '当社は新築戸建ての販売と賃貸仲介を行っています。', business_detail_source: 'OFFICIAL_WEBSITE', description: null }).length > 0,
    'OFFICIAL_WEBSITE のものだけ引用する',
  );
  const memoLike = await all(
    `SELECT id, name, business_detail FROM companies
      WHERE business_detail IS NOT NULL AND business_detail_source = 'OFFICIAL_WEBSITE'
        AND (business_detail LIKE '%手応え%' OR business_detail LIKE '%取次%' OR business_detail LIKE '%不応答%'
             OR business_detail LIKE '%留守電%' OR business_detail LIKE '%人が応答%')`,
  );
  r.eq('こちらの架電メモが「HP本文」として保存されている', memoLike.length, 0, '社');
  if (memoLike.length > 0) console.log(`         ${memoLike.slice(0, 5).map((x) => `${x.name}: ${String(x.business_detail).slice(0, 30)}`).join(' | ')}`);
  const quotedMemo = await all(
    `SELECT c.name, s.opening, s.purpose FROM call_scripts s JOIN companies c ON c.id = s.company_id`,
  );
  r.eq(
    'ここで作った電話の台本に、こちらの架電メモが混ざっている',
    quotedMemo.filter((x) => /手応え[ＡＢＣＤA-D]|取次で終了|不応答|留守電|人が応答/.test(`${x.opening ?? ''}${x.purpose ?? ''}`)).length,
    0,
    '件',
  );

  // ② 企業名鑑（建設マップ等）の1ページを、その会社の公式HPとして採用してしまった
  //    名鑑は会社名も電話も住所も正しく載っているので、照合だけでは見抜けなかった
  const directoryPage = {
    url: 'https://www.kensetumap.com/company/373596/profile.php',
    title: '新泉工業株式会社の企業情報',
    text: '新泉工業株式会社 大阪府大阪市西区1-1-1 TEL 06-1111-2222 掲載企業を検索できます。無料で掲載を承ります。この企業にお問い合わせ 株式会社さくら建設 株式会社みどり工務店 有限会社あおば設備 運営会社：建設マップ',
  };
  r.check(
    '企業名鑑の1ページを、その会社が書いたHPとして採用しない',
    looksLikeDirectoryPage(directoryPage, '新泉工業株式会社') !== null,
    String(looksLikeDirectoryPage(directoryPage, '新泉工業株式会社')),
  );
  // 名前も電話も住所も正しく載っているので、照合の点数だけを見ると「一致」になってしまう。
  // ホスト名の名簿と、ページの作りの両方で必ず落ちること。
  const dirVerdict = verifyWebsiteIdentity({ name: '新泉工業株式会社', phone: '06-1111-2222', address: '大阪府大阪市西区1-1-1' }, directoryPage);
  r.check('名鑑のページは、名前も電話も合っていてもHPとして採用しない', dirVerdict.verdict !== 'MATCH', `${dirVerdict.verdict} / ${dirVerdict.reason}`);
  // ホスト名の名簿に載っていない名鑑でも、ページの作りだけで落とせること。
  const unknownDirectory = {
    url: 'https://kigyou-db-example.jp/company/884512/profile',
    title: '新泉工業株式会社の企業情報',
    text: '新泉工業株式会社 大阪府大阪市西区1-1-1 TEL 06-1111-2222 掲載企業を検索できます。無料で掲載を承ります。この企業にお問い合わせ 株式会社さくら建設 株式会社みどり工務店 有限会社あおば設備 運営会社：企業データベース',
  };
  const unknownDirVerdict = verifyWebsiteIdentity({ name: '新泉工業株式会社', phone: '06-1111-2222', address: '大阪府大阪市西区1-1-1' }, unknownDirectory);
  r.check(
    '知らない名鑑サイトでも、ページの作りだけで「分からない」にできる',
    unknownDirVerdict.verdict === 'UNKNOWN',
    `${unknownDirVerdict.verdict} / ${unknownDirVerdict.reason}`,
  );
  // ★逆方向の事故も止める。取引先一覧に他社名が並ぶ「自社サイトの会社概要」を名鑑と間違えない。
  const ownAboutPage = {
    url: 'https://sun-f-access.co.jp/company.html',
    title: '会社概要｜株式会社サン・エフ・アクセス',
    text: '株式会社サン・エフ・アクセス 会社概要 主な取引先 株式会社さくら建設 株式会社みどり工務店 有限会社あおば設備 株式会社ひまわり住宅 掲載の内容は変更になる場合があります。',
  };
  r.check(
    '取引先を並べただけの自社の会社概要を、名鑑と間違えない',
    looksLikeDirectoryPage(ownAboutPage, '株式会社サン・エフ・アクセス') === null,
    String(looksLikeDirectoryPage(ownAboutPage, '株式会社サン・エフ・アクセス')),
  );
  r.eq(
    '企業名鑑・求人サイトのURLがHP欄に残っている',
    (await all('SELECT website FROM companies WHERE website IS NOT NULL')).filter((x) => !isOwnSiteUrl(String(x.website))).length,
    0,
    '社',
  );

  // ③ 別会社と判断して外したページの「題名」だけが残り、営業文の書き出しに使われていた
  //    実例: 新泉工業株式会社。企業名鑑のページを読んで題名「会社概要｜新泉工業株式会社」を
  //    紹介文の欄に入れた。あとで「そこは本人のサイトではない」と分かってHP欄からは外したが、
  //    題名は残り、電話の書き出しが「『会社概要｜新泉工業株式会社』と書かれているのを読み」に
  //    なっていた。本人が書いていない文章を、本人に読み上げる形。
  r.check(
    '出どころの分からない紹介文は、その会社が書いた事実として使わない',
    ownWords({ business_detail: null, business_detail_source: null, description: '会社概要｜新泉工業株式会社', description_source: null }).length === 0,
    '出どころがHPでないものは引用しない',
  );
  r.check(
    '本人のHPから取った紹介文は、その会社が書いた事実として使える',
    ownWords({ business_detail: null, business_detail_source: null, description: '大阪で精密部品の加工をしています', description_source: 'OFFICIAL_WEBSITE' }).length > 0,
    'OFFICIAL_WEBSITE のものだけ引用する',
  );
  r.eq(
    '本人のHPと確認できていないのに、紹介文が「HPから取った」ことになっている',
    await scalar("SELECT COUNT(*) FROM companies WHERE description_source = 'OFFICIAL_WEBSITE' AND COALESCE(website_verified, 0) = 0"),
    0,
    '社',
  );
  const quotedTitle = await all('SELECT c.name, d.body FROM outreach_drafts d JOIN companies c ON c.id = d.company_id WHERE d.body IS NOT NULL');
  r.eq(
    '営業文に「会社概要｜…」というページの題名が引用されている',
    quotedTitle.filter((x) => /「[^」]*会社概要[｜|][^」]*」/.test(String(x.body))).length,
    0,
    '件',
  );

  // ④ 業種を、URLの中の文字列で決めてしまった
  //    実例: 株式会社ナガセテクノス（プラスチック製造）。HP本文に載っていたURL
  //    「nagasetechnos.com」の中の "ec" に当たり「EC・小売」と判定され、
  //    「ネット販売が弱い」という、事実でない切り口の営業文ができていた。
  r.check(
    'URLの中の文字列だけで業種を決めない',
    guessIndustry('株式会社ナガセテクノス', 'プラスチック製造業の会社、成形用原料の着色コンパウンドや射出成形をしている。 https://nagasetechnos.com/').key === 'MANUFACTURING',
    String(guessIndustry('株式会社ナガセテクノス', 'プラスチック製造業の会社 https://nagasetechnos.com/').key),
  );
  r.check(
    '「EC」と書いてある会社は、これまでどおりEC・小売と判定できる',
    guessIndustry('株式会社さくら', '自社EC事業と通販を運営しています').key === 'EC_RETAIL',
    String(guessIndustry('株式会社さくら', '自社EC事業と通販を運営しています').key),
  );
  // ★HP本文のメニュー欄に1回出ただけの言葉が、本業を上書きしないこと。
  //   実例: ナガセテクノスは「製造」と何度も書いてあるのに、1回だけの「配送」で
  //   「運送・物流」と判定され、運送会社向けの切り口で営業文ができていた。
  const nagase = guessIndustry(
    '株式会社ナガセテクノス',
    'プラスチック製造業の会社、成形用原料の着色コンパウンドや射出成形をしている。製造品目一覧。製造設備の紹介。 事業紹介 会社概要 配送について お問い合わせ',
  );
  r.check('本文に1回だけ出た言葉で、本業を上書きしない', nagase.key === 'MANUFACTURING', `${nagase.key} / 手がかり「${nagase.matched}」`);

  // ⑤ HPのメニュー欄を、その会社が書いた一文として営業文に引用してしまった
  //    実例: 花田工業株式会社・株式会社日本ファクト。電話の書き出しが
  //    「『総合建設業の花田工業株式会社｜大阪府｜和泉市GREETINGごあいさつBUSINESS事業COMPANY会社概要CONT』
  //      という記載を拝見してお電話しています」になっていた。日本語として意味を成さない。
  r.check(
    'HPのメニュー欄を、その会社が書いた一文として引用しない',
    looksLikeNavigation('総合建設業の花田工業株式会社｜大阪府｜和泉市GREETINGごあいさつBUSINESS事業COMPANY会社概要CONT'),
    'メニューだと判定できる',
  );
  r.check(
    '日本語のメニュー欄も引用しない',
    looksLikeNavigation('総合介護サービスの株式会社日本ファクト会社概要|株式会社日本ファクトホーム会社案内会社概要経営方針'),
    'メニューだと判定できる',
  );
  r.check(
    'ふつうの本文は、メニューと間違えない',
    !looksLikeNavigation('和泉市から全国の対応を行う泉陽工業株式会社、高精密部品の製造から加工、組立までを一貫して自社で行える体制を持つ'),
    '本文はそのまま引用してよい',
  );

  // ⑥ 長い一文を60文字で機械的に切り、語の途中で終わる文面を作ってしまった
  //    実例: 株式会社ナガセテクノス「…同じ断面をもつ形状の製品を製造するこ」
  const chopped = sentencesOf('熱した樹脂を引き延ばしながら金型からサイジングを通り成形することで同じ断面をもつ形状の製品を製造することができます');
  r.eq('語の途中で切れた文を引用している', chopped.filter((s) => s.length >= 60).length, 0, '件');
  // ⑥-2 読点で切ると、文法的には途中で終わった節になる。
  //     実例: 株式会社大日ロジテック「安全と安心、倫理的価値観を持つ判断基準を念頭に、物流という血流を滞らせる」
  //     長すぎる一文は、読点があっても使わない（引用が減るほうを選ぶ）。
  r.eq(
    '長い一文を読点で切って引用している',
    sentencesOf('安全と安心、倫理的価値観を持つ判断基準を念頭に、物流という血流を滞らせることなく社会の基盤を支え続けることを私たちの使命としています').length,
    0,
    '件',
  );
  // ⑦ どのHPにも書いてある挨拶を「その会社が書いた事実」として引用してしまった
  //    実例:「サイトには『どうぞよろしくお願いいたします』とも書かれていましたね」
  r.eq(
    'どの会社にも書いてある挨拶を、その会社の事実として引用している',
    sentencesOf('どうぞよろしくお願いいたします\nお気軽にお問い合わせください\nありがとうございました').length,
    0,
    '件',
  );
  const navQuoted = await all('SELECT c.name, d.body FROM outreach_drafts d JOIN companies c ON c.id = d.company_id WHERE d.body IS NOT NULL');
  r.eq(
    '営業文にHPのメニュー欄がそのまま引用されている',
    navQuoted.filter((x) => (String(x.body).match(/「[^」]{10,}」/g) ?? []).some((q) => looksLikeNavigation(q))).length,
    0,
    '件',
  );
  r.print();

  // ---------------------------------------------------------------- 第二の目（PHASE A4）
  //
  // ★ここで確かめるのは「監査そのものが正しく働くか」。
  //   検査がゆるすぎれば実害のある文面を通してしまうし、
  //   厳しすぎれば正しい文面まで落として、結局その分だけ人が読む羽目になる。
  //   実際に上位20社で見つかった誤判定を、そのまま固定して二度と戻らないようにする。
  const a = new Suite('第二の目：営業文の監査（PHASE A4）');

  const auditCompany: Row = {
    id: 999001,
    name: '株式会社テスト製作所',
    website: 'https://www.test-seisakusho.co.jp/',
    website_verdict: 'VERIFIED',
    business_detail: '当社は大阪府和泉市で精密部品の加工を続けています。お客様の図面どおりに確実に仕上げることを大切にしています。前身は2001年4月ヒタチ工業株式会社です。',
    business_detail_source: 'OFFICIAL_WEBSITE',
    description: null,
    description_source: null,
    prefecture: '大阪府',
    phone: '0725502700',
    email: null,
    corporate_number: null,
    no_sales_flag: 0,
    no_sales_evidence: null,
    form_policy: null,
    industry_guess: 'MANUFACTURING',
  };
  const auditOffer = (await loadOffers(false)).find((o) => o.status === 'SELLABLE') ?? null;

  const runAudit = (body: string, channel = 'EMAIL') =>
    auditCopy({
      company: auditCompany,
      draft: { id: 1, body, channel, offer_code: auditOffer?.code ?? '' },
      offer: auditOffer,
      analysis: null,
      primaryOfferCode: auditOffer?.code ?? null,
    });
  const ngOf = (r0: CopyAudit, code: string) => r0.checks.find((k) => k.code === code && !k.ok);

  // ① 電話台本の締めを切り落として「CTAが無い」と誤判定していた（20社中20社が不合格になった）
  const phoneBody = [
    '突然のお電話失礼いたします。株式会社テスト製作所様のホームページで「当社は大阪府和泉市で精密部品の加工を続けています」と拝見し、ご連絡しました。',
    '',
    '【聞くこと】',
    '・今はどんなやり方で回しておられますか。',
    '',
    '【切り返し】',
    '・「間に合っています」→ 承知しました。',
    '',
    '承知しました。まずは資料をメールでお送りしますので、ご覧ください。',
  ].join('\n');
  a.check('電話台本の締め（CTA）を読み落として不合格にする', ngOf(await runAudit(phoneBody, 'PHONE'), 'CTA_CLARITY') === undefined, '締めの一言を読めている');

  // ② 「〜している株式会社」を別会社の名前として拾い、正しい文面をBLOCKにしていた
  const bogusName = 'お客様の元へお届けしている株式会社テスト製作所様、突然のご連絡失礼いたします。お話を伺えませんか。ご不要でしたらご放念ください。';
  a.check('「〜している株式会社」を別会社の名前と読み違える', ngOf(await runAudit(bogusName), 'COMPANY_IDENTITY') === undefined, '会社名ではないと分かる');

  // ③ 本物の別会社名は、今でも必ず止める（②の直しで甘くなっていないこと）
  const realOther = '株式会社テスト製作所様、突然のご連絡失礼いたします。同業の丸和運輸株式会社様の事例をお持ちしました。お話を伺えませんか。ご不要でしたらご放念ください。';
  a.check('本物の別会社名を見逃す', ngOf(await runAudit(realOther), 'COMPANY_IDENTITY') !== undefined, '別会社の名前は止める');

  // ④ 所在地の欄から組み立てた言い方を「作り話の引用」と誤判定していた
  const derived = '株式会社テスト製作所様、突然のご連絡失礼いたします。「大阪府で事業をされている」と拝見しました。お話を伺えませんか。ご不要でしたらご放念ください。';
  a.check('記録の欄から作った言い方を作り話と誤判定する', ngOf(await runAudit(derived), 'EVIDENCE_PROVENANCE') === undefined, '欄の値と一致すれば根拠あり');

  // ⑤ 会社の記録に無い文字列の引用は、今でも必ず止める（④の直しで甘くなっていないこと）
  const fabricated = '株式会社テスト製作所様、突然のご連絡失礼いたします。「弊社は全国で三千社の導入実績があります」と拝見しました。お話を伺えませんか。ご不要でしたらご放念ください。';
  a.check('会社が書いていない引用を見逃す', ngOf(await runAudit(fabricated), 'EVIDENCE_PROVENANCE') !== undefined, '作り話の引用は止める');

  // ⑥ 相手が自分で書いた「確実に」を、こちらの誇張として不合格にしていた
  const quotedPuffery = '株式会社テスト製作所様、突然のご連絡失礼いたします。「お客様の図面どおりに確実に仕上げることを大切にしています」と拝見しました。お話を伺えませんか。ご不要でしたらご放念ください。';
  a.check('相手が書いた言葉を、こちらの誇張として不合格にする', ngOf(await runAudit(quotedPuffery), 'EXAGGERATION') === undefined, '引用の中は相手の言葉');

  // ⑦ こちらが書いた誇張は、今でも必ず止める（⑥の直しで甘くなっていないこと）
  const ourPuffery = '株式会社テスト製作所様、突然のご連絡失礼いたします。導入すれば作業時間を大幅に削減できます。お話を伺えませんか。ご不要でしたらご放念ください。';
  a.check('こちらが書いた誇張を見逃す', ngOf(await runAudit(ourPuffery), 'EXAGGERATION') !== undefined, 'こちらの誇張は止める');

  // ⑧ 完結した文を「途中で切れている」と誤判定していた
  const completeQuote = '株式会社テスト製作所様、突然のご連絡失礼いたします。「当社は大阪府和泉市で精密部品の加工を続けています」と拝見しました。お話を伺えませんか。ご不要でしたらご放念ください。';
  a.check('完結した文を、途中で切れていると誤判定する', ngOf(await runAudit(completeQuote), 'QUOTE_SANITY') === undefined, '句点で終わる文は完結している');

  // ⑨ 本当に途中で切り取った引用は、今でも必ず止める（⑧の直しで甘くなっていないこと）
  const cutQuote = '株式会社テスト製作所様、突然のご連絡失礼いたします。「当社は大阪府和泉市で精密部品の加工を続けて」と拝見しました。お話を伺えませんか。ご不要でしたらご放念ください。';
  a.check('元の文章の途中で切った引用を見逃す', ngOf(await runAudit(cutQuote), 'QUOTE_SANITY') !== undefined, '途中で切った引用は止める');

  // ⑩ 断りの一言が無い文面は止める（どの言い回しを引いても断りが入るようにした）
  const rude = '株式会社テスト製作所様。「当社は大阪府和泉市で精密部品の加工を続けています」と拝見しました。お話を伺えませんか。ご不要でしたらご放念ください。';
  a.check('断りの一言が無い文面を見逃す', ngOf(await runAudit(rude), 'POLITENESS') !== undefined, '突然の連絡への断りは必須');

  // ⑪ 実データ：保存済みの文面に、断りの一言が無いものが残っていないか
  const openings = await all("SELECT c.name, d.body FROM outreach_drafts d JOIN companies c ON c.id = d.company_id WHERE d.status = 'READY' AND c.data_origin <> 'TEST'");
  a.eq(
    '断りの一言が無いまま出来上がっている営業文',
    openings.filter((x) => !/(突然|失礼|恐れ入り|恐縮|お忙し|はじめてご連絡|お世話になり)/.test(String(x.body).slice(0, 200))).length,
    0,
    '件',
  );

  // ⑫ 監査を通したのに、外部へ送ったものが1件でもあってはならない
  a.eq('監査の時点で外部へ実行したもの（下書き）', Number(await scalar('SELECT COUNT(*) FROM outreach_logs WHERE executed = 1')) || 0, 0, '件');
  a.eq('監査の時点で外部へ実行したもの（下見）', Number(await scalar('SELECT COUNT(*) FROM dry_runs WHERE executed = 1')) || 0, 0, '件');

  a.print();

  finish([p, i, j, d, g, w, r, a]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
