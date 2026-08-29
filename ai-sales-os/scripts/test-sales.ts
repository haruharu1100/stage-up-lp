import { all, one, scalar } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { TESTDATA_EXPECT } from '../lib/testdata';
import { normalizeEmail, normalizePhone, sameOrganization, isOwnSiteUrl, similarity } from '../lib/text';
import { buildDedupeKey, normalizeCorporateNumber } from '../lib/sales/ingest';
import { detectNoSales } from '../lib/sales/nosales';
import { guessIndustry } from '../lib/industry';
import { senderIdentity } from '../lib/sales/sender-identity';
import { canOutreach } from '../lib/sales/guards';
import { trustedByRegistry, verifyWebsiteIdentity } from '../lib/sales/identity';
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
  i.eq('営業お断りの会社に印がついている', await scalar('SELECT COUNT(*) FROM companies WHERE no_sales_flag = 1'), TESTDATA_EXPECT.companyNoSales, '社');
  i.atLeast('営業お断りの会社はNG名簿にも入っている', await scalar('SELECT COUNT(*) FROM ng_registry'), TESTDATA_EXPECT.companyNoSales, '件');
  i.print();

  // ---------------------------------------------------------------- 判断
  const j = new Suite('売るものと連絡手段の判断');
  j.eq('全社に読み取り結果がある', await scalar('SELECT COUNT(*) FROM company_analyses'), companies, '社');
  j.eq('全社に点数がついている', await scalar('SELECT COUNT(*) FROM company_scores'), companies, '社');

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

  finish([p, i, j, d, g, w]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
